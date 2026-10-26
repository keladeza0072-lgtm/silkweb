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
 *
 * Two CHECK boundaries keep that index airtight and the MVP slot model
 * exact, including for direct SQL writers that bypass validation:
 * - `appointments.start_time` must already be the strict canonical UTC
 *   form `YYYY-MM-DDTHH:mm:00.000Z` for a real date on a 30-minute
 *   boundary (shape via GLOB, field ranges via substr, calendar reality
 *   via a strftime round-trip). Rephrased duplicate instants (numeric
 *   offsets, short/long fractional seconds, missing timezone markers)
 *   are rejected at the database boundary, so they can never coexist
 *   with — or evade uniqueness against — the canonical spelling.
 * - `services.duration_minutes` must be exactly 30. The MVP supports only
 *   fixed 30-minute slots; variable-duration services are out of scope.
 *
 * Prototype migration note: `CREATE TABLE IF NOT EXISTS` never retrofits
 * new CHECK constraints onto tables created by an older schema revision.
 * Existing databases must be recreated from scratch (fresh file or
 * `:memory:`); there is no ALTER migration for this prototype slice.
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
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes = 30),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`,
  `CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id INTEGER NOT NULL REFERENCES staff(id),
    service_id INTEGER NOT NULL REFERENCES services(id),
    start_time TEXT NOT NULL CHECK (
      start_time GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:00.000Z'
      AND substr(start_time, 6, 2) BETWEEN '01' AND '12'
      AND substr(start_time, 9, 2) BETWEEN '01' AND '31'
      AND substr(start_time, 12, 2) BETWEEN '00' AND '23'
      AND substr(start_time, 15, 2) IN ('00', '30')
      AND strftime('%Y-%m-%dT%H:%M:00.000Z', start_time) = start_time
      AND strftime('%Y-%m-%dT%H:%M:00.000Z', start_time) IS NOT NULL
    ),
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
