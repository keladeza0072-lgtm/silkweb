import type { DatabaseSync } from 'node:sqlite';

/**
 * booking-schema@0.1.0 — SQLite tables for staff, services and appointments.
 *
 * Active-booking uniqueness (one staff member, one start time) is enforced
 * by the database itself via partial unique index
 * `appointments_active_slot_unique`, so conflicting reservations cannot be
 * committed even by callers that bypass application-level checks.
 * Cancelled rows are excluded from the index, so a cancelled slot can be
 * rebooked.
 */

export const SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS staff (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`,
  `CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`,
  `CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id INTEGER NOT NULL REFERENCES staff(id),
    service_id INTEGER NOT NULL REFERENCES services(id),
    start_time TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS appointments_active_slot_unique
    ON appointments (staff_id, start_time)
    WHERE status = 'active'`,
];

/** Create (or verify) all booking tables and indexes. Idempotent. */
export function createBookingSchema(db: DatabaseSync): void {
  for (const statement of SCHEMA_STATEMENTS) {
    db.exec(statement);
  }
}

/** Row shapes returned by the slot guard. */
export interface AppointmentRow {
  id: number;
  staff_id: number;
  service_id: number;
  start_time: string;
  status: 'active' | 'cancelled';
}
