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
