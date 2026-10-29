/**
 * Operator-only POSITIVE EVALUATOR CONTROL for RES-001.
 *
 * Deliberately kept under experiments/harness, outside both Muse workspaces.
 * Reuses the certified registry implementation to check whether a compliant
 * app can achieve a complete score. NOT a coding-agent submission.
 * No model inference, no source cloning, no benchmark result claims.
 */
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  initializeReservationKernel,
  createIdempotentBooking,
  cancelReservation,
  getBooking,
} from '../../../../packages/registry/dist/index.js';

const dbPath = process.env.DB_PATH;
if (!dbPath || !isAbsolute(dbPath)) {
  process.stderr.write('DB_PATH must be an absolute SQLite file path\n');
  process.exit(2);
}
const port = Number(process.env.PORT ?? '3000');
if (!Number.isSafeInteger(port) || port <= 0 || port > 65535) {
  process.stderr.write('invalid PORT\n');
  process.exit(2);
}

mkdirSync(dirname(resolve(dbPath)), { recursive: true });
const db = new DatabaseSync(resolve(dbPath));
initializeReservationKernel(db);
// Stable seed IDs, without resetting existing booking state.
db.prepare('INSERT OR IGNORE INTO staff (id, name) VALUES (?, ?)').run(1, 'Ada');
db.prepare('INSERT OR IGNORE INTO staff (id, name) VALUES (?, ?)').run(2, 'Ben');
db.prepare('INSERT OR IGNORE INTO services (id, name, duration_minutes) VALUES (?, ?, ?)').run(1, 'Standard cut', 30);

const send = (res, status, object) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(object));
};

function bookingJson(row) {
  return {
    id: row.id,
    staffId: row.staff_id,
    serviceId: row.service_id,
    startTime: row.start_time,
    status: row.status,
  };
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk.toString('utf8');
    if (raw.length > 65536) {
      const err = new Error('body too large');
      err.code = 'INVALID_REQUEST';
      throw err;
    }
  }
  try {
    const value = JSON.parse(raw);
    if (!value || Array.isArray(value) || typeof value !== 'object') {
      const err = new Error('expected JSON object');
      err.code = 'INVALID_REQUEST';
      throw err;
    }
    return value;
  } catch (e) {
    if (e.code === 'INVALID_REQUEST') throw e;
    const err = new Error('invalid JSON');
    err.code = 'INVALID_JSON';
    throw err;
  }
}

function mapError(error) {
  const code = error && typeof error.code === 'string'
    ? error.code
    : 'INTERNAL_ERROR';
  const statuses = new Map([
    ['BOOKING_VALIDATION_ERROR', 400],
    ['INVALID_IDEMPOTENCY_KEY', 400],
    ['BOOKING_REFERENCE_ERROR', 400],
    ['INVALID_JSON', 400],
    ['INVALID_REQUEST', 400],
    ['SLOT_CONFLICT', 409],
    ['IDEMPOTENCY_KEY_CONFLICT', 409],
    ['BOOKING_STATE_ERROR', 409],
    ['BOOKING_NOT_FOUND', 404],
    ['RESERVATION_BUSY', 503],
  ]);
  return { code, status: statuses.get(code) ?? 500 };
}

const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    if (req.method === 'GET' && path === '/health') {
      send(res, 200, { ok: true });
      return;
    }

    if (req.method === 'POST' && path === '/bookings') {
      const input = await readJson(req);
      const result = createIdempotentBooking(db, input);
      send(res, result.replayed ? 200 : 201, {
        booking: bookingJson(result.booking),
        replayed: result.replayed,
      });
      return;
    }

    const cancel = /^\/bookings\/([1-9][0-9]*)\/cancel$/.exec(path);
    if (req.method === 'POST' && cancel) {
      await readJson(req);
      const id = Number(cancel[1]);
      send(res, 200, { booking: bookingJson(cancelReservation(db, id)) });
      return;
    }

    const read = /^\/bookings\/([1-9][0-9]*)$/.exec(path);
    if (req.method === 'GET' && read) {
      send(res, 200, { booking: bookingJson(getBooking(db, Number(read[1]))) });
      return;
    }

    send(res, 404, { error: { code: 'NOT_FOUND' } });
  } catch (error) {
    const { code, status } = mapError(error);
    send(res, status, { error: { code } });
  }
});

server.listen(port, '127.0.0.1');

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
