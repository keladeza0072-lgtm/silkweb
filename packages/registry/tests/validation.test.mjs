import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBookingInput,
  isSlotAligned,
  BookingValidationError,
  BOOKING_VALIDATION_ERROR_CODE,
} from '../dist/index.js';

describe('booking-validation@0.1.0', () => {
  it('accepts canonical UTC inputs on the 00 and 30 minute marks', () => {
    assert.deepEqual(parseBookingInput({ staffId: 1, serviceId: 2, startTime: '2026-11-01T09:00:00.000Z' }), {
      staffId: 1,
      serviceId: 2,
      startTime: '2026-11-01T09:00:00.000Z',
    });
    assert.deepEqual(parseBookingInput({ staffId: 1, serviceId: 1, startTime: '2026-11-01T09:30:00.000Z' }).startTime, '2026-11-01T09:30:00.000Z');
    // Leap-day boundary is a real date and stays accepted.
    assert.equal(isSlotAligned('2024-02-29T09:30:00.000Z'), true);
  });

  it('rejects every non-canonical spelling of an aligned instant', () => {
    // All of these denote 2026-11-01T09:30:00.000Z but must be refused so
    // equal instants can never evade the staff/slot uniqueness invariant.
    const rephrased = [
      '2026-11-01T09:30:00Z', // missing fractional seconds
      '2026-11-01T09:30:00.00Z', // short fractional seconds
      '2026-11-01T09:30:00.0000Z', // long fractional seconds
      '2026-11-01T09:30:00.000+00:00', // explicit numeric offset
      '2026-11-01T11:30:00.000+02:00', // same instant via offset
      '2026-11-01T09:30:00.000', // missing timezone marker
      '2026-11-01T09:30:00.000z', // lowercase timezone marker
      '2026-11-01 09:30:00.000Z', // space separator (non-ISO)
      '11/01/2026 09:30', // non-ISO date string
    ];
    for (const startTime of rephrased) {
      assert.equal(isSlotAligned(startTime), false, `isSlotAligned accepted ${startTime}`);
      assert.throws(
        () => parseBookingInput({ staffId: 1, serviceId: 1, startTime }),
        (error) => error instanceof BookingValidationError && error.code === BOOKING_VALIDATION_ERROR_CODE,
        `expected rejection of ${startTime}`,
      );
    }
  });

  it('rejects unreal calendar dates even in canonical shape', () => {
    for (const startTime of [
      '2026-13-01T09:00:00.000Z', // month 13
      '2026-00-01T09:00:00.000Z', // month 00
      '2026-02-30T09:00:00.000Z', // February 30th
      '2026-04-31T09:00:00.000Z', // April 31st
      '2025-02-29T09:00:00.000Z', // non-leap February 29th
      '2026-11-00T09:00:00.000Z', // day 00
      '2026-11-32T09:00:00.000Z', // day 32
      '2026-11-01T24:00:00.000Z', // hour 24
    ]) {
      assert.equal(isSlotAligned(startTime), false, `isSlotAligned accepted ${startTime}`);
      assert.throws(
        () => parseBookingInput({ staffId: 1, serviceId: 1, startTime }),
        (error) => error instanceof BookingValidationError && error.code === BOOKING_VALIDATION_ERROR_CODE,
        `expected rejection of ${startTime}`,
      );
    }
  });

  it('rejects times off the 30-minute grid', () => {
    for (const startTime of [
      '2026-11-01T09:15:00.000Z',
      '2026-11-01T09:45:00.000Z',
      '2026-11-01T09:00:30.000Z',
      '2026-11-01T09:00:00.500Z',
    ]) {
      assert.throws(
        () => parseBookingInput({ staffId: 1, serviceId: 1, startTime }),
        (error) => error instanceof BookingValidationError && error.code === BOOKING_VALIDATION_ERROR_CODE,
        `expected rejection of ${startTime}`,
      );
    }
  });

  it('rejects unparsable or empty start times', () => {
    for (const startTime of ['not-a-time', '', '2026-13-01T09:00:00Z']) {
      assert.throws(
        () => parseBookingInput({ staffId: 1, serviceId: 1, startTime }),
        BookingValidationError,
      );
    }
  });

  it('rejects non-positive or non-integer ids and missing fields', () => {
    const bad = [
      { staffId: 0, serviceId: 1, startTime: '2026-11-01T09:00:00.000Z' },
      { staffId: -1, serviceId: 1, startTime: '2026-11-01T09:00:00.000Z' },
      { staffId: 1.5, serviceId: 1, startTime: '2026-11-01T09:00:00.000Z' },
      { staffId: '1', serviceId: 1, startTime: '2026-11-01T09:00:00.000Z' },
      { staffId: 1, serviceId: 0, startTime: '2026-11-01T09:00:00.000Z' },
      { staffId: 1, startTime: '2026-11-01T09:00:00.000Z' },
      { serviceId: 1, startTime: '2026-11-01T09:00:00.000Z' },
      null,
      'junk',
    ];
    for (const input of bad) {
      assert.throws(
        () => parseBookingInput(input),
        (error) => error instanceof BookingValidationError && error.code === BOOKING_VALIDATION_ERROR_CODE,
        `expected rejection of ${JSON.stringify(input)}`,
      );
    }
  });

  it('exposes a stable error code and issue list', () => {
    try {
      parseBookingInput({ staffId: 0, serviceId: 1, startTime: 'bad' });
      assert.fail('should have thrown');
    } catch (error) {
      assert.ok(error instanceof BookingValidationError);
      assert.equal(error.code, 'BOOKING_VALIDATION_ERROR');
      assert.ok(error.issues.length > 0);
    }
  });

  it('isSlotAligned matches the parser boundary rule', () => {
    assert.equal(isSlotAligned('2026-11-01T09:00:00.000Z'), true);
    assert.equal(isSlotAligned('2026-11-01T09:30:00.000Z'), true);
    assert.equal(isSlotAligned('2026-11-01T09:30:00Z'), false);
    assert.equal(isSlotAligned('2026-11-01T09:15:00.000Z'), false);
    assert.equal(isSlotAligned('garbage'), false);
  });
});
