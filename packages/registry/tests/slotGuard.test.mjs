import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

// Scratch space lives inside the workspace because the sandbox runner
// cannot write to the OS temp directory.
const SCRATCH = join(dirname(fileURLToPath(import.meta.url)), 'tmp');
mkdirSync(SCRATCH, { recursive: true });
import {
  createBookingSchema,
  createBooking,
  getBooking,
  cancelBooking,
  listActiveBookings,
  SlotConflictError,
  BookingReferenceError,
  BookingNotFoundError,
  BookingStateError,
  BookingValidationError,
} from '../dist/index.js';

// Two independent connections to the same file-backed database, so the
// collision tests below exercise cross-connection visibility. This is still
// sequential same-process execution: no genuine simultaneous-race coverage
// is claimed (see limitations in the summary).
describe('booking-slot-guard@0.1.0', () => {
  let dir;
  let file;
  let a;
  let b;

  beforeEach(() => {
    dir = mkdtempSync(join(SCRATCH, 'silkweb-slot-'));
    file = join(dir, 'bookings.db');
    a = new DatabaseSync(file);
    b = new DatabaseSync(file);
    createBookingSchema(a);
    a.prepare(`INSERT INTO staff (name) VALUES ('Ava'), ('Ben')`).run();
    a.prepare(`INSERT INTO services (name, duration_minutes) VALUES ('Cut', 30)`).run();
  });

  afterEach(() => {
    a.close();
    b.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates a booking and reads it back', () => {
    const row = createBooking(a, { staffId: 1, serviceId: 1, startTime: '2026-11-01T09:00:00.000Z' });
    assert.equal(row.staff_id, 1);
    assert.equal(row.status, 'active');
    assert.deepEqual(getBooking(b, Number(row.id)), row);
  });

  it('rejects a conflicting reservation for the same staff/time via the second connection', () => {
    createBooking(a, { staffId: 1, serviceId: 1, startTime: '2026-11-01T09:00:00.000Z' });
    assert.throws(
      () => createBooking(b, { staffId: 1, serviceId: 1, startTime: '2026-11-01T09:00:00.000Z' }),
      (error) => error instanceof SlotConflictError && error.code === 'SLOT_CONFLICT',
    );
    const count = b.prepare(`SELECT COUNT(*) AS c FROM appointments`).get();
    assert.equal(count.c, 1);
  });

  it('allows different staff members to book the same time', () => {
    createBooking(a, { staffId: 1, serviceId: 1, startTime: '2026-11-01T09:00:00.000Z' });
    const other = createBooking(b, { staffId: 2, serviceId: 1, startTime: '2026-11-01T09:00:00.000Z' });
    assert.equal(other.staff_id, 2);
    assert.equal(other.status, 'active');
  });

  it('supports cancellation followed by rebooking of the same slot', () => {
    const first = createBooking(a, { staffId: 1, serviceId: 1, startTime: '2026-11-01T10:00:00.000Z' });
    const cancelled = cancelBooking(b, Number(first.id));
    assert.equal(cancelled.status, 'cancelled');
    const second = createBooking(b, { staffId: 1, serviceId: 1, startTime: '2026-11-01T10:00:00.000Z' });
    assert.equal(second.status, 'active');
    assert.notEqual(Number(second.id), Number(first.id));
  });

  it('fails predictably for unknown bookings and double cancellation', () => {
    assert.throws(() => getBooking(a, 999), BookingNotFoundError);
    assert.throws(
      () => cancelBooking(a, 999),
      (error) => error instanceof BookingNotFoundError && error.code === 'BOOKING_NOT_FOUND',
    );
    const row = createBooking(a, { staffId: 1, serviceId: 1, startTime: '2026-11-01T11:00:00.000Z' });
    cancelBooking(a, Number(row.id));
    assert.throws(
      () => cancelBooking(b, Number(row.id)),
      (error) => error instanceof BookingStateError && error.code === 'BOOKING_STATE_ERROR',
    );
  });

  it('rejects rephrased duplicate instants instead of double-booking', () => {
    createBooking(a, { staffId: 1, serviceId: 1, startTime: '2026-11-01T09:30:00.000Z' });
    // Same instant in non-canonical spellings: validation refuses them, so
    // the uniqueness invariant is never at risk and nothing is stored.
    for (const startTime of [
      '2026-11-01T09:30:00Z',
      '2026-11-01T09:30:00.000+00:00',
      '2026-11-01T11:30:00.000+02:00',
      '2026-11-01T09:30:00.000',
    ]) {
      assert.throws(
        () => createBooking(b, { staffId: 1, serviceId: 1, startTime }),
        (error) => error instanceof BookingValidationError && error.code === 'BOOKING_VALIDATION_ERROR',
        `expected validation rejection of ${startTime}`,
      );
    }
    const count = b.prepare(`SELECT COUNT(*) AS c FROM appointments`).get();
    assert.equal(count.c, 1);
  });

  it('refuses bookings against legacy non-30-minute services', () => {
    // Prototype migration case: a database created before the services
    // CHECK required exactly 30 minutes may still hold a 45-minute row.
    // Bookings against it fail predictably instead of creating overlaps.
    const legacyDir = mkdtempSync(join(SCRATCH, 'silkweb-slot-legacy-'));
    const legacyFile = join(legacyDir, 'bookings.db');
    const legacy = new DatabaseSync(legacyFile);
    try {
      legacy.exec(`CREATE TABLE staff (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)`);
      legacy.exec(
        `CREATE TABLE services (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0))`,
      );
      legacy.exec(
        `CREATE TABLE appointments (id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id INTEGER NOT NULL, service_id INTEGER NOT NULL, start_time TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active')`,
      );
      legacy.prepare(`INSERT INTO staff (name) VALUES ('Ava')`).run();
      legacy.prepare(`INSERT INTO services (name, duration_minutes) VALUES ('Long Cut', 45)`).run();
      createBookingSchema(legacy);
      assert.throws(
        () => createBooking(legacy, { staffId: 1, serviceId: 1, startTime: '2026-11-01T09:00:00.000Z' }),
        (error) => error instanceof BookingReferenceError && error.code === 'BOOKING_REFERENCE_ERROR',
      );
      const count = legacy.prepare(`SELECT COUNT(*) AS c FROM appointments`).get();
      assert.equal(count.c, 0);
    } finally {
      legacy.close();
      rmSync(legacyDir, { recursive: true, force: true });
    }
  });

  it('rejects invalid input and unknown staff/service references', () => {
    assert.throws(
      () => createBooking(a, { staffId: 1, serviceId: 1, startTime: '2026-11-01T09:15:00.000Z' }),
      (error) => error instanceof BookingValidationError && error.code === 'BOOKING_VALIDATION_ERROR',
    );
    assert.throws(
      () => createBooking(a, { staffId: 999, serviceId: 1, startTime: '2026-11-01T09:00:00.000Z' }),
      (error) => error instanceof BookingReferenceError && error.code === 'BOOKING_REFERENCE_ERROR',
    );
    assert.throws(
      () => createBooking(a, { staffId: 1, serviceId: 999, startTime: '2026-11-01T09:00:00.000Z' }),
      BookingReferenceError,
    );
    const count = a.prepare(`SELECT COUNT(*) AS c FROM appointments`).get();
    assert.equal(count.c, 0);
  });

  it('lists active bookings per staff member in time order', () => {
    createBooking(a, { staffId: 1, serviceId: 1, startTime: '2026-11-01T11:00:00.000Z' });
    createBooking(a, { staffId: 1, serviceId: 1, startTime: '2026-11-01T09:00:00.000Z' });
    createBooking(a, { staffId: 2, serviceId: 1, startTime: '2026-11-01T09:00:00.000Z' });
    const mine = listActiveBookings(b, 1).map((row) => row.start_time);
    assert.deepEqual(mine, ['2026-11-01T09:00:00.000Z', '2026-11-01T11:00:00.000Z']);
  });
});
