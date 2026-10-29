#!/usr/bin/env node
/**
 * RES-001: independent HTTP/SQLite evaluator (no model calls).
 *
 * The evaluator runs OUTSIDE both Muse workspaces. Only the starter and
 * task contract are visible to Muse. Do not copy this file into an agent
 * workspace. Do not modify tests after the frozen preflight hash.
 *
 * Usage:
 *   node experiments/harness/res001-evaluate.mjs --candidate ABSOLUTE_PATH --report ABSOLUTE_PATH
 *
 * The candidate must already have a compiled dist/server.js. Each scenario
 * gets a NEW file-backed SQLite DB. The evaluator spawns the real HTTP server
 * and tests wire-level behavior, including concurrent independent processes.
 * It never imports Silk Web's solution or certified registry implementation.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const argv = process.argv.slice(2);
function getArg(key) {
  const at = argv.indexOf(key);
  if (at < 0 || at + 1 >= argv.length) throw new Error('missing argument ' + key);
  return argv[at + 1];
}
if (argv.length !== 4 || !argv.includes('--candidate') || !argv.includes('--report')) {
  throw new Error('usage: --candidate ABSOLUTE_PATH --report ABSOLUTE_PATH');
}
const suppliedCandidate = getArg('--candidate');
const suppliedReport = getArg('--report');
if (!isAbsolute(suppliedCandidate) || !isAbsolute(suppliedReport)) {
  throw new Error('candidate and report paths must be absolute');
}
const candidate = resolve(suppliedCandidate);
const report = resolve(suppliedReport);
if (!existsSync(join(candidate, 'dist/server.js'))) {
  throw new Error('dist/server.js missing; compile candidate before evaluation');
}
if (report.startsWith(candidate + (process.platform === 'win32' ? '\\' : '/'))) {
  throw new Error('report must be stored outside candidate workspace');
}
const scratch = mkdtempSync(join(tmpdir(), 'silkweb-res001-eval-'));
const checks = [];
// Predeclared denominator. Missing or skipped checks are FAILS, never
// excluded from the score when an earlier scenario fails to start.
const standardChecks = [
  'health-ok', 'route-404-json', 'invalid-json', 'first-booking-201',
  'same-key-replay-200', 'read-booking', 'same-slot-other-key-conflict',
  'same-key-different-staff-conflict', 'same-key-different-service-conflict',
  'same-key-different-time-conflict', 'different-staff-same-slot',
  'different-slot-same-staff', 'cancel-active', 'cancel-again-409',
  'read-cancelled', 'replay-after-cancellation-original',
  'new-key-rebooks-cancelled-slot', 'unknown-get-404', 'unknown-cancel-404',
  'valid-half-hour', 'valid-next-date',
  'persistent-create', 'persistent-read-after-restart',
  'persistent-idempotent-replay', 'persistent-conflict-after-restart',
  'two-process-same-key-race', 'two-process-different-key-race',
];
const invalidLabels = [
  'missing-key', 'empty-key', 'whitespace-key', 'missing-staff',
  'negative-staff', 'fractional-staff', 'unknown-staff', 'missing-service',
  'unknown-service', 'off-grid-minute', 'offset-timezone',
  'missing-milliseconds', 'unreal-date', 'seconds-not-zero',
];
const higherWeights = new Map([
  ['first-booking-201', 3],
  ['same-key-replay-200', 3],
  ['same-slot-other-key-conflict', 3],
  ['different-staff-same-slot', 2],
  ['cancel-active', 2],
  ['replay-after-cancellation-original', 3],
  ['new-key-rebooks-cancelled-slot', 2],
  ['persistent-create', 2],
  ['persistent-read-after-restart', 2],
  ['persistent-idempotent-replay', 3],
  ['persistent-conflict-after-restart', 2],
  ['two-process-same-key-race', 5],
  ['two-process-different-key-race', 5],
]);
const expectedIds = [...standardChecks, ...invalidLabels.map(x => 'validation-' + x)];
if (new Set(expectedIds).size !== expectedIds.length || expectedIds.length !== 41) {
  throw new Error('evaluator checklist is not internally consistent');
}
const started = Date.now();
const zeroA = '2026-11-05T09:00:00.000Z';
const halfA = '2026-11-05T09:30:00.000Z';
const zeroB = '2026-11-06T09:00:00.000Z';

function record(id, fn, weight = 1) {
  return Promise.resolve().then(fn).then(
    () => checks.push({ id, weight, passed: true }),
    (error) => checks.push({
      id, weight, passed: false,
      error: String(error instanceof Error ? error.message : error).slice(0, 800),
    }),
  );
}
function request(key, overrides = {}) {
  return { idempotencyKey: key, staffId: 1, serviceId: 1, startTime: zeroA, ...overrides };
}
async function port() {
  return new Promise((ok, fail) => {
    const server = createServer();
    server.on('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const value = server.address().port;
      server.close(() => ok(value));
    });
  });
}
function http(base, route, body, method = 'POST') {
  return (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const options = { method, signal: controller.signal };
      if (body !== undefined) {
        options.headers = { 'Content-Type': 'application/json' };
        options.body = typeof body === 'string' ? body : JSON.stringify(body);
      }
      const response = await fetch(base + route, options);
      const contentType = response.headers.get('content-type') ?? '';
      const raw = await response.text();
      let value;
      try { value = JSON.parse(raw); } catch {
        throw new Error('not JSON (status ' + response.status + '): ' + raw.slice(0, 130));
      }
      assert.match(contentType, /application\/json/i, 'Content-Type must be JSON');
      return { status: response.status, value };
    } finally { clearTimeout(timeout); }
  })();
}
function expectError(r, status, code) {
  assert.equal(r.status, status, 'wrong error status: ' + JSON.stringify(r.value));
  assert.equal(r.value?.error?.code, code, 'wrong error code');
}
function expectBooking(r, status, expected) {
  assert.equal(r.status, status, 'wrong booking status: ' + JSON.stringify(r.value));
  const b = r.value?.booking;
  assert.ok(b && typeof b === 'object', 'missing booking object');
  assert.ok(Number.isSafeInteger(b.id) && b.id > 0, 'missing positive integer booking id');
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(b[key], value, 'booking.' + key);
  }
  return b;
}
async function startServer(dbFile) {
  const listenPort = await port();
  const child = spawn(process.execPath, ['dist/server.js'], {
    cwd: candidate,
    env: {
      ...process.env,
      PORT: String(listenPort),
      DB_PATH: dbFile,
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });
  let stderr = '';
  let exited = false;
  child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-4000); });
  child.on('error', () => { exited = true; });
  child.on('exit', () => { exited = true; });
  const base = 'http://127.0.0.1:' + listenPort;
  for (let attempt = 0; attempt < 90; attempt++) {
    if (exited) throw new Error('server exited early: ' + stderr);
    try {
      const res = await http(base, '/health', undefined, 'GET');
      if (res.status === 200) return {
        base,
        child,
        async stop() {
          if (child.exitCode !== null) return;
          child.kill('SIGTERM');
          await Promise.race([
            new Promise(resolve => child.once('exit', resolve)),
            delay(1800).then(() => child.kill('SIGKILL')),
          ]);
        },
      };
    } catch { /* startup in progress */ }
    await delay(120);
  }
  child.kill('SIGKILL');
  throw new Error('server never became ready: ' + stderr);
}
async function scenario(label, fn) {
  const db = join(scratch, label + '.sqlite');
  const instance = await startServer(db);
  try { await fn(instance.base, db, instance); }
  finally { await instance.stop(); }
}

// Checks are deliberately grouped; failures are independently recorded.
try {
  await scenario('basics', async (base) => {
    await record('health-ok', async () => {
      const r = await http(base, '/health', undefined, 'GET');
      assert.equal(r.status, 200);
      assert.equal(r.value?.ok, true);
    });
    await record('route-404-json', async () => {
      const r = await http(base, '/unrecognized-path', undefined, 'GET');
      assert.equal(r.status, 404);
      assert.ok(r.value?.error?.code);
    });
    await record('invalid-json', async () => {
      const r = await http(base, '/bookings', '{"broken":', 'POST');
      assert.equal(r.status, 400);
      assert.ok(r.value?.error?.code);
    });
    const input = request('basic-1');
    let b;
    await record('first-booking-201', async () => {
      const r = await http(base, '/bookings', input);
      b = expectBooking(r, 201, {
        staffId: 1, serviceId: 1, startTime: zeroA, status: 'active',
      });
      assert.equal(r.value.replayed, false);
    }, 3);
    await record('same-key-replay-200', async () => {
      assert.ok(b, 'requires successful creation');
      const r = await http(base, '/bookings', input);
      const replay = expectBooking(r, 200, { status: 'active' });
      assert.equal(r.value.replayed, true);
      assert.equal(replay.id, b.id);
    }, 3);
    await record('read-booking', async () => {
      assert.ok(b, 'requires successful creation');
      const r = await http(base, '/bookings/' + b.id, undefined, 'GET');
      const found = expectBooking(r, 200, { staffId: 1, startTime: zeroA, status: 'active' });
      assert.equal(found.id, b.id);
    });
    await record('same-slot-other-key-conflict', async () => {
      expectError(await http(base, '/bookings', request('basic-2')), 409, 'SLOT_CONFLICT');
    }, 3);
    await record('same-key-different-staff-conflict', async () => {
      expectError(await http(base, '/bookings', request('basic-1', { staffId: 2 })), 409, 'IDEMPOTENCY_KEY_CONFLICT');
    });
    await record('same-key-different-service-conflict', async () => {
      expectError(await http(base, '/bookings', request('basic-1', { serviceId: 2 })), 409, 'IDEMPOTENCY_KEY_CONFLICT');
    });
    await record('same-key-different-time-conflict', async () => {
      expectError(await http(base, '/bookings', request('basic-1', { startTime: halfA })), 409, 'IDEMPOTENCY_KEY_CONFLICT');
    });
    await record('different-staff-same-slot', async () => {
      expectBooking(await http(base, '/bookings', request('different-staff', { staffId: 2 })), 201, {
        staffId: 2, startTime: zeroA,
      });
    }, 2);
    await record('different-slot-same-staff', async () => {
      expectBooking(await http(base, '/bookings', request('different-time', { startTime: halfA })), 201, {
        staffId: 1, startTime: halfA,
      });
    });
    await record('cancel-active', async () => {
      assert.ok(b, 'requires successful creation');
      expectBooking(await http(base, '/bookings/' + b.id + '/cancel', {}), 200, { status: 'cancelled' });
    }, 2);
    await record('cancel-again-409', async () => {
      assert.ok(b, 'requires successful creation');
      expectError(await http(base, '/bookings/' + b.id + '/cancel', {}), 409, 'BOOKING_STATE_ERROR');
    });
    await record('read-cancelled', async () => {
      assert.ok(b, 'requires successful creation');
      expectBooking(await http(base, '/bookings/' + b.id, undefined, 'GET'), 200, { status: 'cancelled' });
    });
    await record('replay-after-cancellation-original', async () => {
      assert.ok(b, 'requires successful creation');
      const r = await http(base, '/bookings', input);
      const old = expectBooking(r, 200, { status: 'cancelled' });
      assert.equal(old.id, b.id);
      assert.equal(r.value.replayed, true);
    }, 3);
    await record('new-key-rebooks-cancelled-slot', async () => {
      assert.ok(b, 'requires successful creation');
      const replacement = expectBooking(
        await http(base, '/bookings', request('replacement-new-intent')), 201,
        { staffId: 1, startTime: zeroA, status: 'active' },
      );
      assert.notEqual(replacement.id, b.id);
    }, 2);
    await record('unknown-get-404', async () => {
      expectError(await http(base, '/bookings/99999999', undefined, 'GET'), 404, 'BOOKING_NOT_FOUND');
    });
    await record('unknown-cancel-404', async () => {
      expectError(await http(base, '/bookings/99999999/cancel', {}), 404, 'BOOKING_NOT_FOUND');
    });
  });

  await scenario('validation', async (base) => {
    const bad = [
      ['missing-key', { staffId: 1, serviceId: 1, startTime: zeroB }],
      ['empty-key', request('')],
      ['whitespace-key', request('with spaces')],
      ['missing-staff', { idempotencyKey: 'missing-staff', serviceId: 1, startTime: zeroB }],
      ['negative-staff', request('neg-staff', { staffId: -1 })],
      ['fractional-staff', request('frac-staff', { staffId: 1.5 })],
      ['unknown-staff', request('unknown-staff', { staffId: 200 })],
      ['missing-service', { idempotencyKey: 'no-service', staffId: 1, startTime: zeroB }],
      ['unknown-service', request('unknown-service', { serviceId: 12345 })],
      ['off-grid-minute', request('offgrid', { startTime: '2026-11-06T09:15:00.000Z' })],
      ['offset-timezone', request('offset', { startTime: '2026-11-06T09:00:00+00:00' })],
      ['missing-milliseconds', request('no-ms', { startTime: '2026-11-06T09:00:00Z' })],
      ['unreal-date', request('unreal-date', { startTime: '2027-02-30T09:00:00.000Z' })],
      ['seconds-not-zero', request('seconds', { startTime: '2026-11-06T09:00:01.000Z' })],
    ];
    for (const [label, input] of bad) {
      await record('validation-' + label, async () => {
        const res = await http(base, '/bookings', input);
        assert.equal(res.status, 400, JSON.stringify(res.value));
        assert.ok(typeof res.value?.error?.code === 'string' && res.value.error.code.length > 0);
      });
    }
    await record('valid-half-hour', async () => {
      expectBooking(await http(base, '/bookings', request('valid-half', { startTime: halfA })), 201, { startTime: halfA });
    });
    await record('valid-next-date', async () => {
      expectBooking(await http(base, '/bookings', request('valid-date', { startTime: zeroB })), 201, { startTime: zeroB });
    });
  });

  // One DB is restarted; no in-memory-only idempotency can pass this section.
  {
    const db = join(scratch, 'persistence.sqlite');
    const initial = await startServer(db);
    let id;
    try {
      await record('persistent-create', async () => {
        const r = await http(initial.base, '/bookings', request('persist-key'));
        id = expectBooking(r, 201, { status: 'active' }).id;
      }, 2);
    } finally { await initial.stop(); }
    const restarted = await startServer(db);
    try {
      await record('persistent-read-after-restart', async () => {
        assert.ok(id);
        const r = await http(restarted.base, '/bookings/' + id, undefined, 'GET');
        assert.equal(expectBooking(r, 200, { status: 'active' }).id, id);
      }, 2);
      await record('persistent-idempotent-replay', async () => {
        assert.ok(id);
        const r = await http(restarted.base, '/bookings', request('persist-key'));
        assert.equal(expectBooking(r, 200, { status: 'active' }).id, id);
        assert.equal(r.value.replayed, true);
      }, 3);
      await record('persistent-conflict-after-restart', async () => {
        expectError(await http(restarted.base, '/bookings', request('different-persistent-key')), 409, 'SLOT_CONFLICT');
      }, 2);
    } finally { await restarted.stop(); }
  }

  // Two independently running Node processes on the SAME SQLite file.
  // Requests begin on the same event-loop turn; the database must arbitrate.
  {
    const db = join(scratch, 'race-same.sqlite');
    const s1 = await startServer(db);
    let s2;
    try {
      s2 = await startServer(db);
      await record('two-process-same-key-race', async () => {
        const replies = await Promise.all([
          http(s1.base, '/bookings', request('racing-same')),
          http(s2.base, '/bookings', request('racing-same')),
        ]);
        const accepted = replies.filter(r => r.status === 201 || r.status === 200);
        assert.equal(accepted.length, 2, 'same-key requests should eventually both succeed');
        const bookingIds = accepted.map(r => expectBooking(r, r.status, { status: 'active' }).id);
        assert.equal(bookingIds[0], bookingIds[1]);
        assert.deepEqual(accepted.map(r => r.status).sort(), [200, 201]);
        assert.deepEqual(accepted.map(r => r.value.replayed).sort(), [false, true]);
      }, 5);
    } finally {
      await s1.stop();
      if (s2) await s2.stop();
    }
  }

  {
    const db = join(scratch, 'race-conflict.sqlite');
    const s1 = await startServer(db);
    let s2;
    try {
      s2 = await startServer(db);
      await record('two-process-different-key-race', async () => {
        const replies = await Promise.all([
          http(s1.base, '/bookings', request('racing-key-left')),
          http(s2.base, '/bookings', request('racing-key-right')),
        ]);
        assert.deepEqual(replies.map(r => r.status).sort(), [201, 409]);
        const failed = replies.find(r => r.status === 409);
        assert.equal(failed.value?.error?.code, 'SLOT_CONFLICT');
        const winner = replies.find(r => r.status === 201);
        const id = expectBooking(winner, 201, { status: 'active' }).id;
        const later = await http(s1.base, '/bookings/' + id, undefined, 'GET');
        assert.equal(expectBooking(later, 200, { status: 'active' }).id, id);
      }, 5);
    } finally {
      await s1.stop();
      if (s2) await s2.stop();
    }
  }
} catch (error) {
  checks.push({
    id: 'EVALUATOR_SETUP_OR_PROCESS_FAILURE',
    passed: false,
    weight: 10,
    error: String(error instanceof Error ? error.message : error).slice(0, 1500),
  });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

for (const id of expectedIds) {
  if (!checks.some(check => check.id === id)) {
    checks.push({
      id, weight: higherWeights.get(id) ?? 1, passed: false,
      error: 'Not executed because an earlier setup/scenario failed',
    });
  }
}
const scoredChecks = checks.filter(item => expectedIds.includes(item.id));
for (const item of scoredChecks) {
  const expectedWeight = higherWeights.get(item.id) ?? 1;
  if (item.weight !== expectedWeight) throw new Error('score weight mismatch: ' + item.id);
}
const max = expectedIds.reduce((a, id) => a + (higherWeights.get(id) ?? 1), 0);
const earned = scoredChecks.reduce((a, item) => a + (item.passed ? item.weight : 0), 0);
const result = {
  benchmark: 'RES-001',
  evaluatorVersion: 1,
  candidate,
  date: new Date().toISOString(),
  durationMs: Date.now() - started,
  checks: checks.length,
  passed: checks.filter(c => c.passed).length,
  failed: checks.filter(c => !c.passed).length,
  weightedScore: max ? Math.round(1000 * earned / max) / 10 : 0,
  weightedEarned: earned,
  weightedMax: max,
  details: checks,
};
mkdirSync(dirname(report), { recursive: true });
writeFileSync(report, JSON.stringify(result, null, 2) + '\n', 'utf8');
process.stdout.write(JSON.stringify({
  benchmark: result.benchmark,
  checks: result.checks,
  passed: result.passed,
  failed: result.failed,
  weightedScore: result.weightedScore,
  durationMs: result.durationMs,
  report,
}, null, 2) + '\n');
process.exitCode = result.failed === 0 ? 0 : 1;
