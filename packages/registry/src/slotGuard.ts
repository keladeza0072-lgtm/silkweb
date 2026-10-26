import type { DatabaseSync } from 'node:sqlite';
import type { AppointmentRow } from './schema.js';
import { parseBookingInput, type BookingInput } from './validation.js';

/**
 * booking-slot-guard@0.1.0 — transactional booking creation.
 *
 * Each booking runs in its own `BEGIN IMMEDIATE` transaction: validation
 * first, then an existence check on staff/service (including the MVP
 * fixed-30-minute service duration), then the insert. A
 * conflicting active reservation for the same staff member at the same
 * start time violates the database partial unique index
 * (`appointments_active_slot_unique`) and surfaces as a SlotConflictError;
 * the transaction is always rolled back on failure. Errors are typed with
 * stable `code` fields so callers can branch predictably.
 */

export const SLOT_CONFLICT_CODE = 'SLOT_CONFLICT';
export const BOOKING_REFERENCE_ERROR_CODE = 'BOOKING_REFERENCE_ERROR';
export const BOOKING_NOT_FOUND_CODE = 'BOOKING_NOT_FOUND';
export const BOOKING_STATE_ERROR_CODE = 'BOOKING_STATE_ERROR';

export class SlotConflictError extends Error {
  readonly code = SLOT_CONFLICT_CODE;
  constructor(
    readonly staffId: number,
    readonly startTime: string,
  ) {
    super(
      `slot conflict: staff ${staffId} already has an active booking at ${startTime}`,
    );
    this.name = 'SlotConflictError';
  }
}

export class BookingReferenceError extends Error {
  readonly code = BOOKING_REFERENCE_ERROR_CODE;
  constructor(message: string) {
    super(message);
    this.name = 'BookingReferenceError';
  }
}

export class BookingNotFoundError extends Error {
  readonly code = BOOKING_NOT_FOUND_CODE;
  constructor(readonly bookingId: number) {
    super(`booking not found: ${bookingId}`);
    this.name = 'BookingNotFoundError';
  }
}

export class BookingStateError extends Error {
  readonly code = BOOKING_STATE_ERROR_CODE;
  constructor(message: string) {
    super(message);
    this.name = 'BookingStateError';
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Error && error.message.startsWith('UNIQUE constraint failed')
  );
}

/**
 * Create one active booking. Throws BookingValidationError (bad input),
 * BookingReferenceError (unknown staff/service, or a service whose
 * duration is not exactly 30 minutes), or SlotConflictError
 * (active reservation already holds the staff/time slot).
 */
export function createBooking(db: DatabaseSync, raw: unknown): AppointmentRow {
  const input: BookingInput = parseBookingInput(raw);
  db.exec('BEGIN IMMEDIATE');
  try {
    const staff = db
      .prepare('SELECT id FROM staff WHERE id = ?')
      .get(input.staffId) as { id: number } | undefined;
    if (!staff) {
      throw new BookingReferenceError(`unknown staff id: ${input.staffId}`);
    }
    const service = db
      .prepare('SELECT id, duration_minutes FROM services WHERE id = ?')
      .get(input.serviceId) as { id: number; duration_minutes: number } | undefined;
    if (!service) {
      throw new BookingReferenceError(`unknown service id: ${input.serviceId}`);
    }
    // Defense in depth for databases created before the services CHECK
    // required exactly 30 minutes: refuse bookings against legacy
    // variable-duration services, since the MVP slot model assumes every
    // appointment occupies exactly one fixed 30-minute slot.
    if (service.duration_minutes !== 30) {
      throw new BookingReferenceError(
        `service ${input.serviceId} has unsupported duration_minutes ${service.duration_minutes}: MVP supports fixed 30-minute slots only`,
      );
    }
    try {
      const result = db
        .prepare(
          `INSERT INTO appointments (staff_id, service_id, start_time, status)
           VALUES (?, ?, ?, 'active')`,
        )
        .run(input.staffId, input.serviceId, input.startTime);
      db.exec('COMMIT');
      return getBooking(db, Number(result.lastInsertRowid));
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        throw new SlotConflictError(input.staffId, input.startTime);
      }
      throw error;
    }
  } catch (error: unknown) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ROLLBACK fails only when nothing is outstanding; ignore.
    }
    throw error;
  }
}

/** Fetch one appointment by id. Throws BookingNotFoundError when missing. */
export function getBooking(db: DatabaseSync, bookingId: number): AppointmentRow {
  const row = db
    .prepare('SELECT id, staff_id, service_id, start_time, status FROM appointments WHERE id = ?')
    .get(bookingId) as AppointmentRow | undefined;
  if (!row) throw new BookingNotFoundError(bookingId);
  return row;
}

/**
 * Cancel an active booking. Cancelled slots are excluded from the active
 * uniqueness index, so the same staff/time can be rebooked afterwards.
 * Throws BookingNotFoundError (unknown id) or BookingStateError
 * (already cancelled).
 */
export function cancelBooking(db: DatabaseSync, bookingId: number): AppointmentRow {
  const current = getBooking(db, bookingId);
  if (current.status !== 'active') {
    throw new BookingStateError(`booking ${bookingId} is already ${current.status}`);
  }
  db.prepare(`UPDATE appointments SET status = 'cancelled' WHERE id = ?`).run(bookingId);
  return getBooking(db, bookingId);
}

/** List active bookings for one staff member, ordered by start time. */
export function listActiveBookings(db: DatabaseSync, staffId: number): AppointmentRow[] {
  return db
    .prepare(
      `SELECT id, staff_id, service_id, start_time, status FROM appointments
       WHERE staff_id = ? AND status = 'active' ORDER BY start_time ASC`,
    )
    .all(staffId) as unknown as AppointmentRow[];
}
