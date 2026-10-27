import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createHandler, slotStartsForDate, utcDateKey } from '../dist/app.js';
import { openDatabase } from '../dist/db.js';

// Scratch space lives inside the workspace because the sandbox runner
// cannot write to the OS temp directory. Never the demo database.
//
// These tests invoke the real request handler directly (no listening
// socket), so they run even where loopback binds are restricted. They
// exercise the same code path `server.ts` delegates `/api/*` requests to:
// routing, status codes, registry validation/conflicts, and SQLite.
const SCRATCH = join(dirname(fileURLToPath(import.meta.url)), 'tmp');
mkdirSync(SCRATCH, { recursive: true });

function utcKeyOf(date) {
  return utcDateKey(date);
}

function tomorrowKey() {
  return utcKeyOf(new Date(Date.now() + 86_400_000));
}

function slot(dateKey, hhmm) {
  return `${dateKey}T${hhmm}:00.000Z`;
}

/** Drive the handler with in-memory request/response stand-ins. */
function callHandler(handler, { method = 'GET', path = '/', body = undefined, rawBody = undefined } = {}) {
  return new Promise((resolve, reject) => {
    const payload =
      rawBody !== undefined
        ? Buffer.from(rawBody)
        : body !== undefined
          ? Buffer.from(JSON.stringify(body))
          : null;
    const listeners = {};
    const req = {
      method,
      url: path,
      headers: {},
      on(event, fn) {
        (listeners[event] ??= []).push(fn);
        return this;
      },
      destroy() {},
    };
    const res = {
      statusCode: 0,
      headers: null,
      end(text) {
        let parsed = null;
        try {
          parsed = JSON.parse(String(text ?? ''));
        } catch {
          parsed = null;
        }
        resolve({ status: this.statusCode, headers: this.headers, body: parsed });
      },
      writeHead(status, headers) {
        this.statusCode = status;
        this.headers = headers;
      },
    };
    Promise.resolve()
      .then(() => handler(req, res))
      .catch(reject);
    queueMicrotask(() => {
      try {
        if (payload) for (const fn of listeners.data ?? []) fn(payload);
        for (const fn of listeners.end ?? []) fn();
      } catch (error) {
        reject(error);
      }
    });
  });
}

describe('booking-app vertical slice', () => {
  let dir;
  let dbFile;
  let db;
  let api;

  beforeEach(() => {
    dir = mkdtempSync(join(SCRATCH, 'booking-app-'));
    dbFile = join(dir, 'test.db');
    db = openDatabase(dbFile);
    const handler = createHandler(db);
    api = (path, options) => callHandler(handler, { path, ...options });
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('server path serves seeded staff and services', async () => {
    const staff = await api('/api/staff');
    const services = await api('/api/services');
    assert.equal(staff.status, 200);
    assert.equal(services.status, 200);
    assert.equal(staff.body.staff.length, 2);
    assert.equal(services.body.services.length, 2);
    assert.ok(services.body.services.every((s) => s.duration_minutes === 30));
  });

  it('available slots appear correctly for a fresh date', async () => {
    const date = tomorrowKey();
    const { status, body } = await api(`/api/availability?staffId=1&date=${date}`);
    assert.equal(status, 200);
    assert.equal(body.slots.length, 16);
    assert.equal(body.slots[0].startTime, slot(date, '09:00'));
    assert.equal(body.slots[15].startTime, slot(date, '16:30'));
    assert.ok(body.slots.every((s) => s.booked === false));
  });

  it('booking persists to SQLite and shows in active bookings', async () => {
    const startTime = slot(tomorrowKey(), '10:00');
    const { status, body } = await api('/api/bookings', {
      method: 'POST',
      body: { staffId: 1, serviceId: 1, startTime },
    });
    assert.equal(status, 201);
    assert.equal(body.booking.start_time, startTime);
    const probe = new DatabaseSync(dbFile);
    const row = probe
      .prepare('SELECT staff_id, status FROM appointments WHERE id = ?')
      .get(body.booking.id);
    probe.close();
    assert.equal(row.staff_id, 1);
    assert.equal(row.status, 'active');
    const listed = await api('/api/bookings?staffId=1');
    assert.ok(listed.body.bookings.some((b) => b.id === body.booking.id));
  });

  it('same barber/time conflict returns 409', async () => {
    const startTime = slot(tomorrowKey(), '11:00');
    const payload = { staffId: 1, serviceId: 1, startTime };
    const first = await api('/api/bookings', { method: 'POST', body: payload });
    assert.equal(first.status, 201);
    const second = await api('/api/bookings', { method: 'POST', body: payload });
    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, 'SLOT_CONFLICT');
  });

  it('different barbers can share a time', async () => {
    const startTime = slot(tomorrowKey(), '11:30');
    for (const staffId of [1, 2]) {
      const { status } = await api('/api/bookings', {
        method: 'POST',
        body: { staffId, serviceId: 1, startTime },
      });
      assert.equal(status, 201);
    }
  });

  it('invalid or off-grid timestamps are rejected', async () => {
    const date = tomorrowKey();
    for (const startTime of [slot(date, '10:15'), 'not-a-date', `${date}T10:00:00+00:00`]) {
      const { status } = await api('/api/bookings', {
        method: 'POST',
        body: { staffId: 1, serviceId: 1, startTime },
      });
      assert.equal(status, 400, `expected 400 for ${startTime}`);
    }
  });

  it('unknown staff or service returns 404', async () => {
    const startTime = slot(tomorrowKey(), '10:00');
    const noStaff = await api('/api/bookings', {
      method: 'POST',
      body: { staffId: 999, serviceId: 1, startTime },
    });
    assert.equal(noStaff.status, 404);
    const noService = await api('/api/bookings', {
      method: 'POST',
      body: { staffId: 1, serviceId: 999, startTime },
    });
    assert.equal(noService.status, 404);
  });

  it('past or out-of-hours bookings are rejected', async () => {
    const past = slot(utcKeyOf(new Date(Date.now() - 86_400_000)), '10:00');
    const farFuture = slot(utcKeyOf(new Date(Date.now() + 30 * 86_400_000)), '10:00');
    const date = tomorrowKey();
    for (const startTime of [past, farFuture, slot(date, '08:00'), slot(date, '17:00'), slot(date, '02:00')]) {
      const { status } = await api('/api/bookings', {
        method: 'POST',
        body: { staffId: 1, serviceId: 1, startTime },
      });
      assert.equal(status, 400, `expected 400 for ${startTime}`);
    }
  });

  it('cancellation releases the slot and rebooking succeeds', async () => {
    const date = tomorrowKey();
    const startTime = slot(date, '14:00');
    const created = await api('/api/bookings', {
      method: 'POST',
      body: { staffId: 1, serviceId: 1, startTime },
    });
    assert.equal(created.status, 201);
    const id = created.body.booking.id;

    let avail = await api(`/api/availability?staffId=1&date=${date}`);
    assert.equal(avail.body.slots.find((s) => s.startTime === startTime).booked, true);

    const cancelled = await api(`/api/bookings/${id}`, { method: 'DELETE' });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.booking.status, 'cancelled');

    avail = await api(`/api/availability?staffId=1&date=${date}`);
    assert.equal(avail.body.slots.find((s) => s.startTime === startTime).booked, false);

    const rebooked = await api('/api/bookings', {
      method: 'POST',
      body: { staffId: 1, serviceId: 1, startTime },
    });
    assert.equal(rebooked.status, 201);
  });

  it('cancelling an unknown or already-cancelled booking fails predictably', async () => {
    const missing = await api('/api/bookings/999999', { method: 'DELETE' });
    assert.equal(missing.status, 404);
    const created = await api('/api/bookings', {
      method: 'POST',
      body: { staffId: 1, serviceId: 1, startTime: slot(tomorrowKey(), '15:00') },
    });
    const id = created.body.booking.id;
    assert.equal((await api(`/api/bookings/${id}`, { method: 'DELETE' })).status, 200);
    const again = await api(`/api/bookings/${id}`, { method: 'DELETE' });
    assert.equal(again.status, 409);
  });

  it('malformed JSON bodies are rejected', async () => {
    const { status } = await api('/api/bookings', { method: 'POST', rawBody: '{oops' });
    assert.equal(status, 400);
  });

  it('slot grid helper covers 09:00-16:30 UTC in 30-minute steps', () => {
    const slots = slotStartsForDate('2026-10-28');
    assert.equal(slots.length, 16);
    assert.equal(slots[0], '2026-10-28T09:00:00.000Z');
    assert.equal(slots[15], '2026-10-28T16:30:00.000Z');
  });
});
