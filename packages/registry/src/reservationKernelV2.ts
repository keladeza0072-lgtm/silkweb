import type { DatabaseSync } from 'node:sqlite';
import { createBookingSchema, type AppointmentRow } from './schema.js';
import { parseBookingInput } from './validation.js';
import {
  getBooking,
  BookingNotFoundError,
  BookingReferenceError,
  BookingStateError,
  SlotConflictError,
} from './slotGuard.js';

/**
 * Additive V2 extension of the certified fixed-30-minute booking kernel.
 * This file deliberately does not modify the V1 source or its certification.
 * The new module is UNVERIFIED until its own executable evidence is recorded.
 */

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/;

export class InvalidIdempotencyKeyError extends Error {
  readonly code = 'INVALID_IDEMPOTENCY_KEY';
  constructor() {
    super('idempotencyKey must be 1-128 ASCII letters, digits, colon, underscore or hyphen; it must start with a letter or digit');
    this.name = 'InvalidIdempotencyKeyError';
  }
}

export class IdempotencyKeyConflictError extends Error {
  readonly code = 'IDEMPOTENCY_KEY_CONFLICT';
  constructor(readonly idempotencyKey: string) {
    super('idempotency key already belongs to a different reservation request');
    this.name = 'IdempotencyKeyConflictError';
  }
}

export class ReservationBusyError extends Error {
  readonly code = 'RESERVATION_BUSY';
  constructor() {
    super('SQLite writer contention exceeded the configured busy timeout; request may be retried');
    this.name = 'ReservationBusyError';
  }
}

export interface IdempotentBookingResult {
  booking: AppointmentRow;
  replayed: boolean;
}

interface KeyRow {
  booking_id: number;
  staff_id: number;
  service_id: number;
  start_time: string;
}

/**
 * Call once on each database connection before handling bookings.
 * Requires an actual SQLite database shared by all participating processes.
 * The original V1 schema is created unchanged.
 */
export function initializeReservationKernel(db: DatabaseSync): void {
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  createBookingSchema(db);
  db.exec(
    'CREATE TABLE IF NOT EXISTS booking_idempotency_keys (' +
    'request_key TEXT PRIMARY KEY NOT NULL CHECK(length(request_key) BETWEEN 1 AND 128), ' +
    'booking_id INTEGER NOT NULL UNIQUE REFERENCES appointments(id), ' +
    'staff_id INTEGER NOT NULL, service_id INTEGER NOT NULL, start_time TEXT NOT NULL)'
  );
}

function isBusy(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /SQLITE_BUSY|database is locked|database table is locked/i.test(error.message);
}

function withWriterTransaction<T>(db: DatabaseSync, operation: () => T): T {
  let begun = false;
  try {
    db.exec('BEGIN IMMEDIATE');
    begun = true;
    const value = operation();
    db.exec('COMMIT');
    begun = false;
    return value;
  } catch (error: unknown) {
    if (begun) {
      try { db.exec('ROLLBACK'); } catch { /* preserve the original error */ }
    }
    if (isBusy(error)) throw new ReservationBusyError();
    throw error;
  }
}

/**
 * A request key binds forever to (staffId, serviceId, startTime) and one
 * booking ID, even after cancellation. Replaying the same request returns
 * the ORIGINAL record, including its current cancelled status; it does
 * not silently rebook a freed slot.
 *
 * BEGIN IMMEDIATE serializes writers across SQLite connections/processes.
 * The existing partial unique index independently guards active slots.
 */
export function createIdempotentBooking(db: DatabaseSync, raw: unknown): IdempotentBookingResult {
  const input = parseBookingInput(raw);
  const requestKey = (
    raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>).idempotencyKey
      : undefined
  );
  if (typeof requestKey !== 'string' || !KEY_PATTERN.test(requestKey)) {
    throw new InvalidIdempotencyKeyError();
  }

  return withWriterTransaction(db, () => {
    const prior = db.prepare(
      'SELECT booking_id, staff_id, service_id, start_time FROM booking_idempotency_keys WHERE request_key = ?'
    ).get(requestKey) as KeyRow | undefined;

    if (prior) {
      if (
        prior.staff_id !== input.staffId ||
        prior.service_id !== input.serviceId ||
        prior.start_time !== input.startTime
      ) throw new IdempotencyKeyConflictError(requestKey);
      return { booking: getBooking(db, prior.booking_id), replayed: true };
    }

    const staff = db.prepare('SELECT id FROM staff WHERE id = ?').get(input.staffId);
    if (!staff) throw new BookingReferenceError('unknown staff id: ' + input.staffId);
    const service = db.prepare('SELECT duration_minutes FROM services WHERE id = ?').get(input.serviceId) as
      | { duration_minutes: number } | undefined;
    if (!service || service.duration_minutes !== 30) {
      throw new BookingReferenceError('unknown service or unsupported duration for service id: ' + input.serviceId);
    }

    let bookingId: number;
    try {
      const inserted = db.prepare(
        "INSERT INTO appointments (staff_id, service_id, start_time, status) VALUES (?, ?, ?, 'active')"
      ).run(input.staffId, input.serviceId, input.startTime);
      bookingId = Number(inserted.lastInsertRowid);
    } catch (error: unknown) {
      if (error instanceof Error && /UNIQUE constraint failed.*appointments/i.test(error.message)) {
        throw new SlotConflictError(input.staffId, input.startTime);
      }
      throw error;
    }

    db.prepare(
      'INSERT INTO booking_idempotency_keys (request_key, booking_id, staff_id, service_id, start_time) ' +
      'VALUES (?, ?, ?, ?, ?)'
    ).run(requestKey, bookingId, input.staffId, input.serviceId, input.startTime);

    return { booking: getBooking(db, bookingId), replayed: false };
  });
}

/** Atomic cancellation: precisely one concurrent caller can transition active to cancelled. */
export function cancelReservation(db: DatabaseSync, bookingId: number): AppointmentRow {
  if (!Number.isSafeInteger(bookingId) || bookingId <= 0) {
    throw new BookingNotFoundError(bookingId);
  }
  return withWriterTransaction(db, () => {
    const existing = getBooking(db, bookingId);
    if (existing.status !== 'active') {
      throw new BookingStateError('booking ' + bookingId + ' is already ' + existing.status);
    }
    const result = db.prepare(
      "UPDATE appointments SET status = 'cancelled' WHERE id = ? AND status = 'active'"
    ).run(bookingId);
    if (result.changes !== 1) {
      throw new BookingStateError('booking ' + bookingId + ' was not active');
    }
    return getBooking(db, bookingId);
  });
}
