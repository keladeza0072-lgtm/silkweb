import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createBookingSchema } from '../dist/schema.js';
import {
  initializeReservationKernel,
  createIdempotentBooking,
  cancelReservation,
  IdempotencyKeyConflictError,
  InvalidIdempotencyKeyError,
} from '../dist/reservationKernelV2.js';
import { BookingValidationError, SlotConflictError, BookingStateError } from '../dist/index.js';

const scratch = join(dirname(fileURLToPath(import.meta.url)), 'tmp');
mkdirSync(scratch, { recursive: true });

const t1 = '2026-11-01T09:00:00.000Z';
const t2 = '2026-11-01T09:30:00.000Z';

function fixture() {
  const directory = mkdtempSync(join(scratch, 'reservation-v2-'));
  const file = join(directory, 'db.sqlite');
  const db = new DatabaseSync(file);
  createBookingSchema(db);
  initializeReservationKernel(db);
  db.prepare("INSERT INTO staff(name) VALUES ('Ada'), ('Ben')").run();
  db.prepare("INSERT INTO services(name,duration_minutes) VALUES ('Cut',30)").run();
  return {
    db, file,
    close() {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
function req(key, staffId = 1, startTime = t1) {
  return { idempotencyKey: key, staffId, serviceId: 1, startTime };
}
function count(db) {
  return Number(db.prepare('SELECT COUNT(*) AS n FROM appointments').get().n);
}

test('same key and payload returns the original booking without a second insert', () => {
  const f = fixture();
  try {
    const first = createIdempotentBooking(f.db, req('retry-1'));
    const second = createIdempotentBooking(f.db, req('retry-1'));
    assert.equal(first.replayed, false);
    assert.equal(second.replayed, true);
    assert.equal(second.booking.id, first.booking.id);
    assert.equal(count(f.db), 1);
  } finally { f.close(); }
});

test('a key reused with a different payload is rejected before another insert', () => {
  const f = fixture();
  try {
    createIdempotentBooking(f.db, req('retry-2'));
    assert.throws(
      () => createIdempotentBooking(f.db, req('retry-2', 2)),
      (e) => e instanceof IdempotencyKeyConflictError && e.code === 'IDEMPOTENCY_KEY_CONFLICT'
    );
    assert.equal(count(f.db), 1);
  } finally { f.close(); }
});

test('different keys cannot create an active staff/slot conflict', () => {
  const f = fixture();
  try {
    createIdempotentBooking(f.db, req('first'));
    assert.throws(() => createIdempotentBooking(f.db, req('second')), SlotConflictError);
    assert.equal(count(f.db), 1);
    const other = createIdempotentBooking(f.db, req('other-staff', 2));
    assert.equal(other.booking.staff_id, 2);
  } finally { f.close(); }
});

test('cancellation frees the slot, but replay cannot reinstate cancelled booking', () => {
  const f = fixture();
  try {
    const first = createIdempotentBooking(f.db, req('cancel-then-retry'));
    const cancelled = cancelReservation(f.db, first.booking.id);
    assert.equal(cancelled.status, 'cancelled');
    assert.throws(() => cancelReservation(f.db, first.booking.id), BookingStateError);
    const replay = createIdempotentBooking(f.db, req('cancel-then-retry'));
    assert.equal(replay.replayed, true);
    assert.equal(replay.booking.id, first.booking.id);
    assert.equal(replay.booking.status, 'cancelled');
    const replacement = createIdempotentBooking(f.db, req('new-intent'));
    assert.equal(replacement.booking.status, 'active');
    assert.notEqual(replacement.booking.id, first.booking.id);
  } finally { f.close(); }
});

test('invalid retry keys and noncanonical timestamps fail closed', () => {
  const f = fixture();
  try {
    assert.throws(() => createIdempotentBooking(f.db, req('bad key')), InvalidIdempotencyKeyError);
    assert.throws(
      () => createIdempotentBooking(f.db, req('good-key', 1, '2026-11-01T09:00:00+00:00')),
      BookingValidationError
    );
    assert.throws(() => createIdempotentBooking(f.db, req('good-key', 1, t2.replace('30:', '15:'))), BookingValidationError);
    assert.equal(count(f.db), 0);
  } finally { f.close(); }
});

const moduleUrl = new URL('../dist/reservationKernelV2.js', import.meta.url).href;
const workerSource = [
  "import { DatabaseSync } from 'node:sqlite';",
  'import { initializeReservationKernel, createIdempotentBooking } from ' + JSON.stringify(moduleUrl) + ';',
  'const db = new DatabaseSync(process.argv[1]);',
  'initializeReservationKernel(db);',
  'process.stdout.write("READY\\n");',
  'process.stdin.once("data", () => {',
  '  try {',
  '    const r = createIdempotentBooking(db, { idempotencyKey: process.argv[2], staffId: 1, serviceId: 1, startTime: "2026-11-01T09:00:00.000Z" });',
  '    process.stdout.write("RESULT:" + JSON.stringify({ok:true, id:r.booking.id, replayed:r.replayed}) + "\\n");',
  '  } catch (error) {',
  '    process.stdout.write("RESULT:" + JSON.stringify({ok:false, code:error.code || "ERROR", message:error.message}) + "\\n");',
  '  } finally { db.close(); }',
  '});',
].join('\n');

function startWorker(file, key) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', workerSource, file, key], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '';
  let stderr = '';
  let readyDone = false;
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const completed = new Promise((resolve, reject) => {
    child.on('error', (error) => { rejectReady(error); reject(error); });
    child.on('close', (code) => {
      if (!readyDone) rejectReady(new Error('worker exited before READY: ' + stderr));
      if (code !== 0) return reject(new Error('worker exit ' + code + ': ' + stderr + output));
      const match = /RESULT:(\{[^\r\n]+\})/.exec(output);
      if (!match) return reject(new Error('worker produced no result: ' + stderr + output));
      resolve(JSON.parse(match[1]));
    });
  });
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
    if (!readyDone && output.includes('READY')) { readyDone = true; resolveReady(); }
  });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  return {
    ready, completed,
    go() { child.stdin.write('go\n'); child.stdin.end(); },
    kill() { child.kill(); },
  };
}

async function race(file, left, right) {
  const a = startWorker(file, left);
  const b = startWorker(file, right);
  try {
    await Promise.all([a.ready, b.ready]);
    a.go();
    b.go();
    return await Promise.all([a.completed, b.completed]);
  } finally {
    a.kill();
    b.kill();
  }
}

test('two independent simultaneous processes with SAME key share one booking', async () => {
  const f = fixture();
  try {
    const [a, b] = await race(f.file, 'concurrent-same', 'concurrent-same');
    assert.ok(a.ok && b.ok, JSON.stringify([a, b]));
    assert.equal(a.id, b.id);
    assert.equal(Number(a.replayed) + Number(b.replayed), 1);
    assert.equal(count(f.db), 1);
  } finally { f.close(); }
});

test('two independent simultaneous processes with DIFFERENT keys cannot double book', async () => {
  const f = fixture();
  try {
    const [a, b] = await race(f.file, 'concurrent-a', 'concurrent-b');
    assert.equal(Number(a.ok) + Number(b.ok), 1, JSON.stringify([a, b]));
    const rejected = a.ok ? b : a;
    assert.equal(rejected.code, 'SLOT_CONFLICT');
    assert.equal(count(f.db), 1);
  } finally { f.close(); }
});
