import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import {
  createBooking,
  cancelBooking,
  SlotConflictError,
  BookingReferenceError,
  BookingNotFoundError,
  BookingStateError,
  BookingValidationError,
} from '../../../packages/registry/dist/index.js';
import { listStaff, listServices } from './db.js';

/**
 * Demo booking policy (all UTC, enforced on the server):
 * - Business hours 09:00-17:00 UTC; appointments occupy fixed 30-minute
 *   slots, so the latest bookable start is 16:30 UTC.
 * - Bookable dates run from today through today + 6 (seven UTC dates).
 * - The start time must be strictly in the future.
 * Grid alignment and canonical spelling are enforced by the certified
 * registry (booking-validation@0.1.0); the checks below add the demo
 * window on top and never replace registry validation.
 */
export const BUSINESS_OPEN_MINUTES = 9 * 60;
export const BUSINESS_LAST_START_MINUTES = 16 * 60 + 30;
export const WINDOW_DAYS = 7;
export const MAX_BODY_BYTES = 8192;
export const MAX_BOOKINGS = 200;

export type NowFn = () => Date;

export function utcDateKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Seven bookable UTC date keys starting today. */
export function windowDates(now: Date): string[] {
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const out: string[] = [];
  for (let i = 0; i < WINDOW_DAYS; i += 1) {
    out.push(utcDateKey(new Date(base + i * 86_400_000)));
  }
  return out;
}

/** Sixteen canonical 30-minute slot start times for one UTC date. */
export function slotStartsForDate(dateKey: string): string[] {
  const out: string[] = [];
  for (let mins = BUSINESS_OPEN_MINUTES; mins <= BUSINESS_LAST_START_MINUTES; mins += 30) {
    const hh = String(Math.floor(mins / 60)).padStart(2, '0');
    const mm = String(mins % 60).padStart(2, '0');
    out.push(`${dateKey}T${hh}:${mm}:00.000Z`);
  }
  return out;
}

export interface RangeCheck {
  ok: true;
  start: Date;
}

export interface RangeFailure {
  ok: false;
  code: string;
  message: string;
}

/**
 * Demo-window check for a candidate start time. Returns the parsed date on
 * success. Rejects unparseable times, past times, out-of-hours starts, and
 * dates outside the seven-day UTC window with human-readable messages.
 */
export function checkBookableRange(startTime: unknown, now: Date): RangeCheck | RangeFailure {
  if (typeof startTime !== 'string') {
    return { ok: false, code: 'BOOKING_RANGE_ERROR', message: 'startTime must be a string.' };
  }
  const start = new Date(startTime);
  if (!Number.isFinite(start.getTime())) {
    return {
      ok: false,
      code: 'BOOKING_RANGE_ERROR',
      message: `startTime ${JSON.stringify(startTime)} is not a valid date. Use the canonical UTC form YYYY-MM-DDTHH:mm:00.000Z.`,
    };
  }
  if (start.getTime() <= now.getTime()) {
    return {
      ok: false,
      code: 'BOOKING_RANGE_ERROR',
      message: `startTime ${startTime} is in the past. All times are UTC; pick a future slot.`,
    };
  }
  const minutes = start.getUTCHours() * 60 + start.getUTCMinutes();
  if (
    minutes < BUSINESS_OPEN_MINUTES ||
    minutes > BUSINESS_LAST_START_MINUTES ||
    minutes % 30 !== 0
  ) {
    return {
      ok: false,
      code: 'BOOKING_RANGE_ERROR',
      message: `startTime ${startTime} is outside business hours. Bookable starts are 09:00-16:30 UTC on 30-minute boundaries.`,
    };
  }
  if (!windowDates(now).includes(utcDateKey(start))) {
    return {
      ok: false,
      code: 'BOOKING_RANGE_ERROR',
      message: `startTime ${startTime} is outside the demo window. Bookable dates run from ${windowDates(now)[0]} through ${windowDates(now)[WINDOW_DAYS - 1]} (UTC).`,
    };
  }
  return { ok: true, start };
}

interface BookingView {
  id: number;
  staff_id: number;
  service_id: number;
  start_time: string;
  status: 'active' | 'cancelled';
  staff_name: string;
  service_name: string;
}

function activeBookingsFor(db: DatabaseSync, staffId: number | null): BookingView[] {
  const where = staffId === null ? '' : 'WHERE a.status = \'active\' AND a.staff_id = ?';
  const params = staffId === null ? [] : [staffId];
  const rows = db
    .prepare(
      `SELECT a.id, a.staff_id, a.service_id, a.start_time, a.status,
              s.name AS staff_name, v.name AS service_name
       FROM appointments a
       JOIN staff s ON s.id = a.staff_id
       JOIN services v ON v.id = a.service_id
       ${staffId === null ? "WHERE a.status = 'active'" : where}
       ORDER BY a.start_time ASC LIMIT ${MAX_BOOKINGS}`,
    )
    .all(...params) as unknown as BookingView[];
  return rows;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  sendJson(res, status, { error: { code, message } });
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    req.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request body too large.'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf-8');
      if (text.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(Object.assign(new Error('Request body is not valid JSON.'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function positiveInt(value: unknown): number | null {
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const n = Number(value);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  }
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  return null;
}

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Create the HTTP request handler. `nowFn` is injectable for tests. */
export function createHandler(db: DatabaseSync, nowFn: NowFn = () => new Date()) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const { pathname } = url;
      const method = (req.method ?? 'GET').toUpperCase();

      if (method === 'GET' && pathname === '/api/health') {
        sendJson(res, 200, { ok: true, service: 'booking-app' });
        return;
      }
      if (method === 'GET' && pathname === '/api/staff') {
        sendJson(res, 200, { staff: listStaff(db) });
        return;
      }
      if (method === 'GET' && pathname === '/api/services') {
        sendJson(res, 200, { services: listServices(db) });
        return;
      }
      if (method === 'GET' && pathname === '/api/availability') {
        const staffId = positiveInt(url.searchParams.get('staffId'));
        const date = url.searchParams.get('date') ?? '';
        if (staffId === null) {
          sendError(res, 400, 'BOOKING_RANGE_ERROR', 'Query parameter staffId must be a positive integer.');
          return;
        }
        if (!DATE_KEY_PATTERN.test(date)) {
          sendError(res, 400, 'BOOKING_RANGE_ERROR', 'Query parameter date must use the UTC form YYYY-MM-DD.');
          return;
        }
        const staffExists = db.prepare('SELECT id FROM staff WHERE id = ?').get(staffId);
        if (!staffExists) {
          sendError(res, 404, 'BOOKING_REFERENCE_ERROR', `Unknown staff id: ${staffId}.`);
          return;
        }
        if (!windowDates(nowFn()).includes(date)) {
          const window = windowDates(nowFn());
          sendError(
            res,
            400,
            'BOOKING_RANGE_ERROR',
            `Date ${date} is outside the demo window ${window[0]} through ${window[WINDOW_DAYS - 1]} (UTC).`,
          );
          return;
        }
        const now = nowFn();
        const taken = new Set(
          (
            db
              .prepare(
                'SELECT start_time FROM appointments WHERE staff_id = ? AND status = \'active\'',
              )
              .all(staffId) as Array<{ start_time: string }>
          ).map((row) => row.start_time),
        );
        const slots = slotStartsForDate(date).map((startTime) => ({
          startTime,
          booked: taken.has(startTime),
          past: new Date(startTime).getTime() <= now.getTime(),
        }));
        sendJson(res, 200, { staffId, date, slots });
        return;
      }
      if (method === 'GET' && pathname === '/api/bookings') {
        const raw = url.searchParams.get('staffId');
        if (raw !== null && positiveInt(raw) === null) {
          sendError(res, 400, 'BOOKING_RANGE_ERROR', 'Query parameter staffId must be a positive integer.');
          return;
        }
        sendJson(res, 200, {
          bookings: activeBookingsFor(db, raw === null ? null : Number(raw)),
        });
        return;
      }
      if (method === 'POST' && pathname === '/api/bookings') {
        let body: unknown;
        try {
          body = await readBody(req);
        } catch (error: unknown) {
          const status = (error as { statusCode?: number }).statusCode ?? 400;
          sendError(res, status, 'BOOKING_RANGE_ERROR', (error as Error).message);
          return;
        }
        const input = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
        const range = checkBookableRange(input.startTime, nowFn());
        if (!range.ok) {
          sendError(res, 400, range.code, range.message);
          return;
        }
        try {
          const booking = createBooking(db, {
            staffId: input.staffId,
            serviceId: input.serviceId,
            startTime: input.startTime,
          });
          sendJson(res, 201, { booking });
        } catch (error: unknown) {
          if (error instanceof SlotConflictError) {
            sendError(
              res,
              409,
              error.code,
              `That slot is already booked for this barber at ${error.startTime} (UTC). Pick another time.`,
            );
          } else if (error instanceof BookingValidationError) {
            sendError(res, 400, error.code, error.message);
          } else if (error instanceof BookingReferenceError) {
            sendError(res, 404, error.code, error.message);
          } else {
            throw error;
          }
        }
        return;
      }
      const cancelMatch = /^\/api\/bookings\/(\d+)$/.exec(pathname);
      if (method === 'DELETE' && cancelMatch) {
        const bookingId = positiveInt(cancelMatch[1]);
        if (bookingId === null) {
          sendError(res, 400, 'BOOKING_RANGE_ERROR', 'Booking id must be a positive integer.');
          return;
        }
        try {
          const booking = cancelBooking(db, bookingId);
          sendJson(res, 200, { booking });
        } catch (error: unknown) {
          if (error instanceof BookingNotFoundError) {
            sendError(res, 404, error.code, error.message);
          } else if (error instanceof BookingStateError) {
            sendError(res, 409, error.code, error.message);
          } else {
            throw error;
          }
        }
        return;
      }
      sendError(res, 404, 'NOT_FOUND', `No route for ${method} ${pathname}.`);
    } catch (error: unknown) {
      // eslint-disable-next-line no-console
      console.error('booking-app handler error:', error);
      sendError(res, 500, 'INTERNAL_ERROR', 'Unexpected server error.');
    }
  };
}
