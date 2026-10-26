import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBookingInput,
  isSlotAligned,
  BookingValidationError,
  BOOKING_VALIDATION_ERROR_CODE,
} from '../dist/index.js';

describe('booking-validation@0.1.0', () => {
  it('accepts aligned UTC inputs on the 00 and 30 minute marks', () => {
    assert.deepEqual(parseBookingInput({ staffId: 1, serviceId: 2, startTime: '2026-11-01T09:00:00.000Z' }), {
      staffId: 1,
      serviceId: 2,
      startTime: '2026-11-01T09:00:00.000Z',
    });
    assert.deepEqual(parseBookingInput({ staffId: 1, serviceId: 1, startTime: '2026-11-01T09:30:00Z' }).startTime, '2026-11-01T09:30:00Z');
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
    assert.equal(isSlotAligned('2026-11-01T09:30:00Z'), true);
    assert.equal(isSlotAligned('2026-11-01T09:15:00.000Z'), false);
    assert.equal(isSlotAligned('garbage'), false);
  });
});
