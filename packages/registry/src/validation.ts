import * as z from 'zod/v4';

/**
 * booking-validation@0.1.0 — validated booking input plus 30-minute slot
 * constraints. Times must use the single strict canonical UTC form
 * `YYYY-MM-DDTHH:mm:00.000Z` (minutes 00 or 30, zero seconds and
 * milliseconds, literal `Z` suffix). Any other textual representation of
 * the same instant — numeric timezone offsets, missing/short/long
 * fractional seconds, missing timezone markers, non-ISO strings — is
 * rejected, so equal instants always compare equal as stored text and the
 * database uniqueness index cannot be evaded by rephrasing a timestamp.
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

/**
 * Exact canonical start-time shape: `YYYY-MM-DDTHH:mm:00.000Z` with minutes
 * restricted to 00 or 30. The regex alone cannot reject unreal calendar
 * dates (e.g. February 30th) or out-of-range fields, so callers must also
 * round-trip the parsed components (see `isSlotAligned`).
 */
const CANONICAL_START_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(00|30):00\.000Z$/;

/**
 * True only for the strict canonical UTC form `YYYY-MM-DDTHH:mm:00.000Z`
 * denoting a real calendar date on a 30-minute boundary. Alternate textual
 * representations of the same instant (numeric timezone offsets, missing
 * or non-`Z` timezone markers, short/long/omitted fractional seconds,
 * non-ISO strings) and unreal dates (month 13, February 30th, hour 24,
 * non-leap February 29th, …) all return false.
 */
export function isSlotAligned(startTime: string): boolean {
  if (typeof startTime !== 'string') return false;
  const match = CANONICAL_START_TIME_PATTERN.exec(startTime);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const parsed = new Date(startTime);
  if (!Number.isFinite(parsed.getTime())) return false;
  return (
    parsed.getUTCFullYear() === Number(yearText) &&
    parsed.getUTCMonth() + 1 === Number(monthText) &&
    parsed.getUTCDate() === Number(dayText) &&
    parsed.getUTCHours() === Number(hourText) &&
    parsed.getUTCMinutes() === Number(minuteText) &&
    parsed.getUTCSeconds() === 0 &&
    parsed.getUTCMilliseconds() === 0
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
      `startTime: must be the canonical UTC form YYYY-MM-DDTHH:mm:00.000Z for a real date on a 30-minute boundary (minutes 00 or 30); offsets, alternate spellings and unreal dates are rejected, got ${JSON.stringify(parsed.data.startTime)}`,
    ]);
  }
  return parsed.data;
}
