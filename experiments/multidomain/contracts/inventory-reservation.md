# INV-001 — Certified candidate: SQLite inventory reservation

**State:** not implemented, not verified, not in trusted registry.

## Runtime and export contract

Node.js >=24, TypeScript NodeNext, `node:sqlite` `DatabaseSync`. No network calls.
Implement precisely `src/inventory.ts` and export these synchronous functions:

- `initializeInventory(db: DatabaseSync): void` — idempotent schema setup; use database constraints.
- `seedStock(db: DatabaseSync, sku: string, available: number): void` — insert a new SKU and initial integer stock; reject an existing SKU rather than silently resetting stock.
- `availableStock(db: DatabaseSync, sku: string): number` — return current nonnegative quantity; unknown SKU throws `STOCK_NOT_FOUND`.
- `reserveStock(db: DatabaseSync, request: {key: string, sku: string, quantity: number}): {reservationId: number, replayed: boolean, available: number}` — atomic reservation.
- `releaseStock(db: DatabaseSync, reservationId: number): {released: boolean, available: number}` — atomic release; first call restores stock, later calls return `released:false` without restoring it again.

Errors are ordinary `Error` objects with a stable `code` string:
`INVALID_INPUT`, `STOCK_EXISTS`, `STOCK_NOT_FOUND`,
`INSUFFICIENT_STOCK`, `IDEMPOTENCY_CONFLICT`, `RESERVATION_NOT_FOUND`.
Never return a success result after a failed transaction.

## Exact invariants

1. `sku` and `key` must be nonempty printable ASCII identifier strings (1–128 chars); `quantity` must be a positive safe integer; stock must be a nonnegative safe integer.
2. A reservation permanently binds a key to one exact SKU/quantity, including after release. A repeated identical key never deducts stock again and returns the same reservationId with `replayed:true`.
3. Reusing a key for another SKU or quantity throws `IDEMPOTENCY_CONFLICT`; no mutation.
4. A successful new reservation decreases available stock by exactly the quantity; insufficient stock never creates a reservation.
5. Two distinct keys cannot oversell a single stock item, including with independent Node processes and SQLite connections. Use transactional write locking; do not assume one in-process mutex protects multiple workers.
6. Releasing a reservation restores its quantity **once**; replaying its key after release cannot subtract it again.
7. Use prepared statements for identifiers and values. Do not use in-memory maps as authoritative state.
8. Preserve persistence when closing and reopening the same SQLite database file.

## Evaluation

Held-out evaluator checks direct source imports, persistence, idempotency,
rejection behavior, input validation, release semantics and two competing
workers against the same stock. No claimed distributed transaction support.

The evaluator is operator-only. Do not read test implementation during
paid Muse development. `src/inventory.ts` is the sole required output.
