import type { DatabaseSync } from "node:sqlite";

export type InventoryErrorCode =
  | "INVALID_INPUT"
  | "STOCK_EXISTS"
  | "STOCK_NOT_FOUND"
  | "INSUFFICIENT_STOCK"
  | "IDEMPOTENCY_CONFLICT"
  | "RESERVATION_NOT_FOUND";

export interface ReserveRequest {
  key: string;
  sku: string;
  quantity: number;
}

export interface ReserveResult {
  reservationId: number;
  replayed: boolean;
  available: number;
}

export interface ReleaseResult {
  released: boolean;
  available: number;
}

function fail(code: InventoryErrorCode, message: string): never {
  const err = new Error(message) as Error & { code: InventoryErrorCode };
  err.code = code;
  throw err;
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 128 &&
    // Printable ASCII only (0x20–0x7E), no control/unicode/empty.
    /^[\x20-\x7E]+$/.test(value)
  );
}

function checkIdentifier(value: unknown, name: string): asserts value is string {
  if (!isIdentifier(value)) {
    fail(
      "INVALID_INPUT",
      `${name} must be a nonempty printable ASCII string of 1-128 characters`,
    );
  }
}

function checkQuantity(value: unknown): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    fail("INVALID_INPUT", "quantity must be a positive safe integer");
  }
}

function checkStockLevel(value: unknown): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    fail("INVALID_INPUT", "available stock must be a nonnegative safe integer");
  }
}

function checkReservationId(value: unknown): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    fail("INVALID_INPUT", "reservationId must be a positive safe integer");
  }
}

/**
 * Idempotent schema setup. Safe to call on every connection, including
 * concurrent first-use from independent processes.
 */
export function initializeInventory(db: DatabaseSync): void {
  if (db === null || db === undefined || typeof db !== "object") {
    fail("INVALID_INPUT", "db must be a DatabaseSync instance");
  }
  // WAL lets readers proceed while a writer holds the lock; harmless for
  // :memory: databases (reported back as "memory"). Persisted in the file.
  db.exec(`PRAGMA journal_mode = WAL`);
  db.exec(`PRAGMA busy_timeout = 5000`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS stock (
      sku TEXT PRIMARY KEY,
      available INTEGER NOT NULL CHECK (available >= 0)
    );
    CREATE TABLE IF NOT EXISTS reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      sku TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      released INTEGER NOT NULL DEFAULT 0 CHECK (released IN (0, 1))
    );
  `);
}

/**
 * Insert a new SKU with its initial stock level. Rejects an existing SKU
 * with STOCK_EXISTS instead of resetting its level.
 */
export function seedStock(
  db: DatabaseSync,
  sku: string,
  available: number,
): void {
  checkIdentifier(sku, "sku");
  checkStockLevel(available);
  try {
    db.prepare(`INSERT INTO stock (sku, available) VALUES (?, ?)`).run(
      sku,
      available,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      message.includes("UNIQUE constraint failed") ||
      message.includes("PRIMARY KEY")
    ) {
      fail("STOCK_EXISTS", `stock already exists for sku "${sku}"`);
    }
    throw err;
  }
}

/** Return the current nonnegative quantity for a SKU. */
export function availableStock(db: DatabaseSync, sku: string): number {
  checkIdentifier(sku, "sku");
  const row = db
    .prepare(`SELECT available FROM stock WHERE sku = ?`)
    .get(sku) as { available: number } | undefined;
  if (row === undefined) {
    fail("STOCK_NOT_FOUND", `no stock found for sku "${sku}"`);
  }
  return row.available;
}

/**
 * Atomically reserve `quantity` units of `sku` under idempotency `key`.
 *
 * Uses BEGIN IMMEDIATE so independent processes serialize on the write
 * lock; a busy_timeout lets losers wait instead of failing with
 * SQLITE_BUSY. A conditional UPDATE guards the check-then-act so two
 * distinct keys can never oversell one stock row.
 */
export function reserveStock(
  db: DatabaseSync,
  request: { key: string; sku: string; quantity: number },
): ReserveResult {
  if (request === null || typeof request !== "object") {
    fail("INVALID_INPUT", "request must be an object");
  }
  const { key, sku, quantity } = request as ReserveRequest;
  checkIdentifier(key, "key");
  checkIdentifier(sku, "sku");
  checkQuantity(quantity);

  db.exec(`PRAGMA busy_timeout = 5000`);
  db.exec(`BEGIN IMMEDIATE`);
  try {
    // Idempotency: a key is permanently bound to one exact SKU/quantity,
    // including after release — a replay never deducts stock again.
    const existing = db
      .prepare(`SELECT id, sku, quantity FROM reservations WHERE key = ?`)
      .get(key) as
      | { id: number; sku: string; quantity: number }
      | undefined;
    if (existing !== undefined) {
      if (existing.sku !== sku || existing.quantity !== quantity) {
        fail(
          "IDEMPOTENCY_CONFLICT",
          `key "${key}" was already used for a different sku/quantity`,
        );
      }
      const current = db
        .prepare(`SELECT available FROM stock WHERE sku = ?`)
        .get(existing.sku) as { available: number } | undefined;
      if (current === undefined) {
        fail("STOCK_NOT_FOUND", `no stock found for sku "${existing.sku}"`);
      }
      db.exec(`COMMIT`);
      return {
        reservationId: existing.id,
        replayed: true,
        available: current.available,
      };
    }

    const stock = db
      .prepare(`SELECT available FROM stock WHERE sku = ?`)
      .get(sku) as { available: number } | undefined;
    if (stock === undefined) {
      fail("STOCK_NOT_FOUND", `no stock found for sku "${sku}"`);
    }
    if (stock.available < quantity) {
      fail(
        "INSUFFICIENT_STOCK",
        `insufficient stock for sku "${sku}": requested ${quantity}, available ${stock.available}`,
      );
    }

    // Conditional decrement: exactly one concurrent winner can take the
    // last units; losers see zero changed rows.
    const update = db
      .prepare(
        `UPDATE stock SET available = available - ? WHERE sku = ? AND available >= ?`,
      )
      .run(quantity, sku, quantity);
    if (update.changes !== 1) {
      fail(
        "INSUFFICIENT_STOCK",
        `insufficient stock for sku "${sku}": requested ${quantity}`,
      );
    }
    const inserted = db
      .prepare(
        `INSERT INTO reservations (key, sku, quantity, released) VALUES (?, ?, ?, 0)`,
      )
      .run(key, sku, quantity);
    const reservationId = Number(inserted.lastInsertRowid);
    const after = db
      .prepare(`SELECT available FROM stock WHERE sku = ?`)
      .get(sku) as { available: number } | undefined;
    if (after === undefined) {
      fail("STOCK_NOT_FOUND", `no stock found for sku "${sku}"`);
    }
    db.exec(`COMMIT`);
    return { reservationId, replayed: false, available: after.available };
  } catch (err) {
    try {
      db.exec(`ROLLBACK`);
    } catch {
      // ROLLBACK itself failing (e.g. no active transaction) must not
      // mask the original error.
    }
    throw err;
  }
}

/**
 * Atomically release a reservation, restoring its quantity exactly once.
 * Replays return released:false and restore nothing further.
 */
export function releaseStock(
  db: DatabaseSync,
  reservationId: number,
): ReleaseResult {
  checkReservationId(reservationId);

  db.exec(`PRAGMA busy_timeout = 5000`);
  db.exec(`BEGIN IMMEDIATE`);
  try {
    const existing = db
      .prepare(
        `SELECT id, sku, quantity, released FROM reservations WHERE id = ?`,
      )
      .get(reservationId) as
      | { id: number; sku: string; quantity: number; released: number }
      | undefined;
    if (existing === undefined) {
      fail(
        "RESERVATION_NOT_FOUND",
        `no reservation found with id ${reservationId}`,
      );
    }

    const stock = db
      .prepare(`SELECT available FROM stock WHERE sku = ?`)
      .get(existing.sku) as { available: number } | undefined;
    if (stock === undefined) {
      fail("STOCK_NOT_FOUND", `no stock found for sku "${existing.sku}"`);
    }

    if (existing.released === 1) {
      db.exec(`COMMIT`);
      return { released: false, available: stock.available };
    }

    db.prepare(`UPDATE reservations SET released = 1 WHERE id = ?`).run(
      existing.id,
    );
    db.prepare(`UPDATE stock SET available = available + ? WHERE sku = ?`).run(
      existing.quantity,
      existing.sku,
    );
    const after = db
      .prepare(`SELECT available FROM stock WHERE sku = ?`)
      .get(existing.sku) as { available: number } | undefined;
    if (after === undefined) {
      fail("STOCK_NOT_FOUND", `no stock found for sku "${existing.sku}"`);
    }
    db.exec(`COMMIT`);
    return { released: true, available: after.available };
  } catch (err) {
    try {
      db.exec(`ROLLBACK`);
    } catch {
      // Never mask the original error.
    }
    throw err;
  }
}
