import * as z from 'zod/v4';

/**
 * booking-validation@0.1.0 — validated booking input plus 30-minute slot
 * constraints. Times are UTC ISO-8601 strings (`YYYY-MM-DDTHH:mm:00.000Z`
 * shape; any ISO string parsing to an exact aligned instant is accepted)
 * whose minute is 00 or 30 with zero seconds and milliseconds.
 */

/** Stable error code for every validation failure from this module. */
export const BOOKING_VALIDATION_ERROR_CODE = 'BOOKING_VALIDATION_ERROR';

export class BookingValidationError extends Error {
  readonly code = BOOKING_VALIDATION_ERROR_CODE;
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`invalid booking input: ${issues.join('; ')}`);
    this.name = 'BookingValidationError';
    this.issues = issues;
  }
}

const bookingInputSchema = z.object({
  staffId: z.number().int().positive(),
  serviceId: z.number().int().positive(),
  startTime: z.string().min(1),
});

export type BookingInput = z.infer<typeof bookingInputSchema>;

/** True when `startTime` parses and sits exactly on a 30-minute boundary. */
export function isSlotAligned(startTime: string): boolean {
  const millis = Date.parse(startTime);
  if (!Number.isFinite(millis)) return false;
  const date = new Date(millis);
  return (
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0 &&
    date.getUTCMinutes() % 30 === 0
  );
}

/**
 * Parse and validate raw booking input. Throws BookingValidationError with
 * a stable `code` on any failure (wrong types, non-positive ids, unparsable
 * time, or a time off the 30-minute grid).
 */
export function parseBookingInput(raw: unknown): BookingInput {
  const parsed = bookingInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new BookingValidationError(
      parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
      ),
    );
  }
  if (!isSlotAligned(parsed.data.startTime)) {
    throw new BookingValidationError([
      `startTime: must be a valid UTC ISO-8601 time on a 30-minute boundary (minutes 00 or 30, zero seconds), got ${JSON.stringify(parsed.data.startTime)}`,
    ]);
  }
  return parsed.data;
}
