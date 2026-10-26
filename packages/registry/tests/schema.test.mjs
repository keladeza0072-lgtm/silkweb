import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createBookingSchema } from '../dist/index.js';

describe('booking-schema@0.1.0', () => {
  it('creates staff, services and appointments tables', () => {
    const db = new DatabaseSync(':memory:');
    createBookingSchema(db);
    const names = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('staff', 'services', 'appointments') ORDER BY name`)
      .all()
      .map((row) => row.name);
    assert.deepEqual(names, ['appointments', 'services', 'staff']);
  });

  it('is idempotent: repeated creation does not throw or duplicate', () => {
    const db = new DatabaseSync(':memory:');
    createBookingSchema(db);
    createBookingSchema(db);
    const count = db
      .prepare(`SELECT COUNT(*) AS c FROM sqlite_master WHERE name = 'appointments'`)
      .get();
    assert.equal(count.c, 1);
  });

  it('enforces database-level uniqueness for active bookings of one staff at one time', () => {
    const db = new DatabaseSync(':memory:');
    createBookingSchema(db);
    db.prepare(`INSERT INTO staff (name) VALUES ('Ava')`).run();
    db.prepare(`INSERT INTO services (name, duration_minutes) VALUES ('Cut', 30)`).run();
    db.prepare(
      `INSERT INTO appointments (staff_id, service_id, start_time, status) VALUES (1, 1, '2026-11-01T09:00:00.000Z', 'active')`,
    ).run();
    assert.throws(
      () =>
        db.prepare(
          `INSERT INTO appointments (staff_id, service_id, start_time, status) VALUES (1, 1, '2026-11-01T09:00:00.000Z', 'active')`,
        ).run(),
      /UNIQUE constraint failed/,
    );
  });

  it('allows the same start time for different staff members', () => {
    const db = new DatabaseSync(':memory:');
    createBookingSchema(db);
    db.prepare(`INSERT INTO staff (name) VALUES ('Ava'), ('Ben')`).run();
    db.prepare(`INSERT INTO services (name, duration_minutes) VALUES ('Cut', 30)`).run();
    for (const staffId of [1, 2]) {
      db.prepare(
        `INSERT INTO appointments (staff_id, service_id, start_time, status) VALUES (?, 1, '2026-11-01T09:00:00.000Z', 'active')`,
      ).run(staffId);
    }
    const count = db.prepare(`SELECT COUNT(*) AS c FROM appointments`).get();
    assert.equal(count.c, 2);
  });

  it('allows rebooking a staff/time slot after cancellation', () => {
    const db = new DatabaseSync(':memory:');
    createBookingSchema(db);
    db.prepare(`INSERT INTO staff (name) VALUES ('Ava')`).run();
    db.prepare(`INSERT INTO services (name, duration_minutes) VALUES ('Cut', 30)`).run();
    const id = db.prepare(
      `INSERT INTO appointments (staff_id, service_id, start_time, status) VALUES (1, 1, '2026-11-01T09:00:00.000Z', 'active')`,
    ).run().lastInsertRowid;
    db.prepare(`UPDATE appointments SET status = 'cancelled' WHERE id = ?`).run(id);
    db.prepare(
      `INSERT INTO appointments (staff_id, service_id, start_time, status) VALUES (1, 1, '2026-11-01T09:00:00.000Z', 'active')`,
    ).run();
    const active = db
      .prepare(`SELECT COUNT(*) AS c FROM appointments WHERE status = 'active'`)
      .get();
    assert.equal(active.c, 1);
  });

  it('rejects non-canonical start_time spellings at the database level', () => {
    const db = new DatabaseSync(':memory:');
    createBookingSchema(db);
    db.prepare(`INSERT INTO staff (name) VALUES ('Ava')`).run();
    db.prepare(`INSERT INTO services (name, duration_minutes) VALUES ('Cut', 30)`).run();
    // Same instant, non-canonical text: short form, numeric offsets,
    // missing timezone marker, non-ISO string, unreal date, hour 24.
    for (const startTime of [
      '2026-11-01T09:30:00Z',
      '2026-11-01T09:30:00.000+00:00',
      '2026-11-01T11:30:00.000+02:00',
      '2026-11-01T09:30:00.000',
      '11/01/2026 09:30',
      '2026-02-30T09:00:00.000Z',
      '2026-11-01T24:00:00.000Z',
      '2026-11-01T09:15:00.000Z',
    ]) {
      assert.throws(
        () =>
          db.prepare(
            `INSERT INTO appointments (staff_id, service_id, start_time, status) VALUES (1, 1, ?, 'active')`,
          ).run(startTime),
        /CHECK constraint failed/,
        `expected CHECK rejection of ${startTime}`,
      );
    }
    const count = db.prepare(`SELECT COUNT(*) AS c FROM appointments`).get();
    assert.equal(count.c, 0);
  });

  it('duplicate instants cannot evade the staff/slot uniqueness invariant', () => {
    const db = new DatabaseSync(':memory:');
    createBookingSchema(db);
    db.prepare(`INSERT INTO staff (name) VALUES ('Ava')`).run();
    db.prepare(`INSERT INTO services (name, duration_minutes) VALUES ('Cut', 30)`).run();
    db.prepare(
      `INSERT INTO appointments (staff_id, service_id, start_time, status) VALUES (1, 1, '2026-11-01T09:30:00.000Z', 'active')`,
    ).run();
    // Identical canonical text still collides on the unique index …
    assert.throws(
      () =>
        db.prepare(
          `INSERT INTO appointments (staff_id, service_id, start_time, status) VALUES (1, 1, '2026-11-01T09:30:00.000Z', 'active')`,
        ).run(),
      /UNIQUE constraint failed/,
    );
    // … while every alternate spelling of the same instant is stopped by
    // the canonical-form CHECK before uniqueness is even reached, so no
    // second row for the same staff/instant can exist under any spelling.
    for (const startTime of [
      '2026-11-01T09:30:00Z',
      '2026-11-01T09:30:00.000+00:00',
      '2026-11-01T11:30:00.000+02:00',
    ]) {
      assert.throws(
        () =>
          db.prepare(
            `INSERT INTO appointments (staff_id, service_id, start_time, status) VALUES (1, 1, ?, 'active')`,
          ).run(startTime),
        /CHECK constraint failed/,
        `expected CHECK rejection of ${startTime}`,
      );
    }
    const count = db.prepare(`SELECT COUNT(*) AS c FROM appointments WHERE status = 'active'`).get();
    assert.equal(count.c, 1);
  });

  it('enforces exactly 30-minute service durations at the database level', () => {
    const db = new DatabaseSync(':memory:');
    createBookingSchema(db);
    for (const minutes of [0, 15, 45, 60, -30]) {
      assert.throws(
        () => db.prepare(`INSERT INTO services (name, duration_minutes) VALUES ('Cut', ?)`).run(minutes),
        /CHECK constraint failed/,
        `expected CHECK rejection of duration_minutes=${minutes}`,
      );
    }
    db.prepare(`INSERT INTO services (name, duration_minutes) VALUES ('Cut', 30)`).run();
    const count = db.prepare(`SELECT COUNT(*) AS c FROM services`).get();
    assert.equal(count.c, 1);
  });

  it('rejects invalid status values at the database level', () => {
    const db = new DatabaseSync(':memory:');
    createBookingSchema(db);
    assert.throws(
      () =>
        db.prepare(
          `INSERT INTO appointments (staff_id, service_id, start_time, status) VALUES (1, 1, '2026-11-01T09:00:00.000Z', 'pending')`,
        ).run(),
      /CHECK constraint failed/,
    );
  });
});
