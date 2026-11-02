import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { ImageAdsJobManager, QueueFullError } from '../dist/imageAdsJobs.js';
import { serveStatic, handleApi, demoJobCap } from '../dist/server.js';
import { checkDemoAccess, DemoJobCap, resolveMaxDemoJobs, demoCodeFromHeader } from '../dist/demoAccess.js';

const threeAds = { status: 200, payload: { ok: true, ads: [{ id: 'ad-1' }, { id: 'ad-2' }, { id: 'ad-3' }] } };
const tick = () => new Promise((r) => setTimeout(r, 15));
const gate = () => { let release; const p = new Promise((r) => { release = r; }); return { p, release }; };

// 1. Unique job IDs
test('1 unique unpredictable job IDs', async () => {
  const m = new ImageAdsJobManager();
  const g = gate();
  const runner = async () => { await g.p; return threeAds; };
  const a = m.submit({ productName: 'A' }, runner);
  const b = m.submit({ productName: 'B' }, runner);
  assert.notEqual(a.jobId, b.jobId);
  assert.match(a.jobId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  g.release(); await tick();
});

// 2. Concurrency max 1
test('2 concurrency max 1, second job stays queued', async () => {
  const m = new ImageAdsJobManager({ maxConcurrent: 1, maxQueueDepth: 8 });
  const g = gate();
  let active = 0; let maxActive = 0;
  const runner = async () => { active += 1; maxActive = Math.max(maxActive, active); await g.p; active -= 1; return threeAds; };
  const a = m.submit({}, runner);
  const b = m.submit({}, runner);
  assert.equal(m.getJob(a.jobId).status, 'running');
  assert.equal(m.getJob(b.jobId).status, 'queued');
  assert.equal(m.activeCount, 1);
  g.release(); await tick(); await tick();
  assert.equal(maxActive, 1);
  assert.equal(m.getJob(b.jobId).status, 'succeeded');
});

// 3. Bounded queue and overload
test('3 bounded queue rejects overload with QueueFullError', async () => {
  const m = new ImageAdsJobManager({ maxConcurrent: 1, maxQueueDepth: 1 });
  const g = gate();
  const runner = async () => { await g.p; return threeAds; };
  m.submit({}, runner); m.submit({}, runner);
  assert.throws(() => m.submit({}, runner), QueueFullError);
  assert.equal(m.activeCount, 1); assert.equal(m.queuedCount, 1);
  g.release(); await tick();
});

// 4. Queued -> running -> succeeded
test('4 queued to running to succeeded lifecycle', async () => {
  const m = new ImageAdsJobManager({ maxConcurrent: 1 });
  const g1 = gate(); const g2 = gate();
  const first = m.submit({}, async () => { await g1.p; return threeAds; });
  const second = m.submit({}, async () => { await g2.p; return threeAds; });
  assert.equal(m.getJob(second.jobId).status, 'queued');
  g1.release(); await tick();
  assert.equal(m.getJob(first.jobId).status, 'succeeded');
  assert.equal(m.getJob(second.jobId).status, 'running');
  g2.release(); await tick();
  assert.equal(m.getJob(second.jobId).status, 'succeeded');
});

// 5. Failure with safe public error
test('5 failure surfaces sanitized error without secrets or stack', async () => {
  const m = new ImageAdsJobManager();
  const failed = await m.submitAndWait({}, async () => ({ status: 502, payload: { ok: false, error: { code: 'PLANNER_ERROR', message: 'Creative planning failed.' } } }));
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error.code, 'PLANNER_ERROR');
  assert.ok(!JSON.stringify(failed).includes('MODEL_API_KEY'));
  const thrown = await m.submitAndWait({}, async () => { throw new Error('secret stack MODEL_API_KEY'); });
  assert.equal(thrown.status, 'failed');
  assert.equal(thrown.error.code, 'GENERATION_FAILED');
  assert.ok(!thrown.error.message.includes('secret'));
  assert.ok(!thrown.error.message.includes('MODEL_API_KEY'));
});

// 6. Exactly three mock ad results
test('6 succeeded job returns exactly three ads', async () => {
  const m = new ImageAdsJobManager();
  const done = await m.submitAndWait({ productName: 'Luma Candles', objective: 'drive-sales' }, async () => threeAds);
  assert.equal(done.status, 'succeeded');
  assert.equal(done.result.ads.length, 3);
});

// 7. Repeated polling never re-runs generation
test('7 repeated status polling does not generate again', async () => {
  const m = new ImageAdsJobManager();
  let calls = 0;
  const g = gate();
  const runner = async () => { calls += 1; await g.p; return threeAds; };
  const snap = m.submit({}, runner);
  m.getJob(snap.jobId); m.getJob(snap.jobId); m.getJob(snap.jobId);
  assert.equal(calls, 1);
  g.release(); await tick();
  m.getJob(snap.jobId); m.getJob(snap.jobId);
  assert.equal(calls, 1);
  assert.equal(m.getJob(snap.jobId).status, 'succeeded');
});

// 8. Direct route (submitAndWait) cannot bypass queue limits
test('8 submitAndWait respects queue, plus server route wiring', async () => {
  const m = new ImageAdsJobManager({ maxConcurrent: 1, maxQueueDepth: 1 });
  const g = gate();
  let calls = 0;
  const runner = async () => { calls += 1; await g.p; return threeAds; };
  m.submit({}, runner); m.submit({}, runner);
  await assert.rejects(() => m.submitAndWait({}, runner), QueueFullError);
  assert.equal(calls, 1);
  g.release(); await tick(); await tick();
  const serverSrc = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
  const direct = serverSrc.slice(serverSrc.indexOf("'/api/image-ads/generate-live'"));
  assert.ok(direct.includes('submitAndWait'));
  assert.ok(direct.includes('QueueFullError'));
  assert.ok(!direct.includes('imageAdsGenerateLiveOutcome(parsed'));
  const jobsRoute = serverSrc.slice(serverSrc.indexOf("'/api/image-ads/jobs'"), serverSrc.indexOf("'/api/image-ads/jobs/'"));
  assert.ok(jobsRoute.includes('imageAdsJobManager.submit'));
  assert.ok(serverSrc.includes('maxConcurrent: 1'));
});

// 9. Invalid or expired job ID
test('9 invalid unknown and expired job IDs return null', async () => {
  let now = 100000;
  const m = new ImageAdsJobManager({ resultTtlMs: 1000, now: () => now });
  assert.equal(m.getJob('not-a-job'), null);
  assert.equal(m.getJob(''), null);
  assert.equal(m.getJob('00000000-0000-4000-8000-000000000000'), null);
  const done = await m.submitAndWait({}, async () => threeAds);
  assert.equal(m.getJob(done.jobId).status, 'succeeded');
  now += 5000;
  assert.equal(m.getJob(done.jobId), null);
});

// 10. Frontend form semantics and routes intact
test('10 frontend form semantics, jobs polling, benchmark figures intact', () => {
  for (const route of ['/', '/creative', '/code', '/evidence', '/research']) assert.ok(serveStatic(route), route);
  for (const n of ['01', '02', '03']) {
    const f = serveStatic(`/media/serum/silkweb-serum-ad-${n}.webp`);
    assert.ok(f); assert.equal(f.type, 'image/webp');
  }
  const index = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  for (const s of ['184,439', '80,643', '410.072s', '347.76s', '98.5/100', '100/100', '56.28%', '15.20%', 'Single paired trial, not an average', 'not independently established', 'href="/evidence"', 'code-bench']) assert.ok(index.includes(s), s);
  const creative = readFileSync(new URL('../public/creative.html', import.meta.url), 'utf8');
  for (const s of ['id="product-image"', 'id="product-name"', 'id="objective-grid"', 'id="differentiator"', 'Three ads per generation', 'id="generate-btn"', 'id="ads-grid"']) assert.ok(creative.includes(s), s);
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.ok(app.includes('/api/image-ads/jobs'));
  assert.ok(app.includes('pollJob'));
  assert.ok(app.includes('queued'));
  assert.ok(app.includes('running'));
  assert.ok(app.includes('JOB_NOT_FOUND') || app.includes('no longer available'));
  assert.ok(app.includes('productImage') && app.includes('objective: selectedObjective()'));
  assert.ok(app.includes('Download PNG') && app.includes('Copy ad text'));
  assert.ok(!app.includes('/api/image-ads/generate-live'));
  const css = readFileSync(new URL('../public/presentation.css', import.meta.url), 'utf8');
  assert.ok(css.includes('.code-bench'));
  assert.ok(css.includes('.cb-track'));
});

// --- Step 275: demo access protection (mock only, no real API) ---
const CODE = 'test-demo-code-275';
let ipSeq = 0;
function mockReq(method, path, { headers = {}, body } = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  req.method = method; req.headers = headers; req.socket = { remoteAddress: `10.9.8.${++ipSeq}` };
  req.url = path; return req;
}
function mockRes() {
  return { status: 0, headers: {}, body: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, writeHead(s, h = {}) { this.status = s; for (const [k, v] of Object.entries(h)) this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b ? String(b) : ''; } };
}
async function call(method, path, opts) {
  const res = mockRes();
  const handled = await handleApi(mockReq(method, path, opts), res, new URL(path, 'http://test'));
  assert.ok(handled, path); return { status: res.status, payload: JSON.parse(res.body || '{}') };
}
function withEnv(patch, fn) {
  return async () => {
    const keys = ['SILKWEB_DEMO_ACCESS_CODE', 'SILKWEB_MAX_DEMO_JOBS', 'SILKWEB_CREATIVE_PROVIDER', 'MODEL_API_KEY', 'SILKWEB_MUSE_API_KEY'];
    const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    demoJobCap.reset();
    try { for (const k of keys) delete process.env[k]; Object.assign(process.env, patch); return await fn(); }
    finally { for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } demoJobCap.reset(); }
  };
}
const paidBody = { productName: 'Luma Candles', objective: 'drive-sales' };
const goodHeaders = { 'x-silkweb-demo-code': CODE };

test('11 missing demo code rejected on both paid routes', withEnv({ SILKWEB_DEMO_ACCESS_CODE: CODE }, async () => {
  assert.equal(checkDemoAccess(undefined, { SILKWEB_DEMO_ACCESS_CODE: CODE }).status, 401);
  for (const path of ['/api/image-ads/jobs', '/api/image-ads/generate-live']) {
    const r = await call('POST', path, { body: paidBody });
    assert.equal(r.status, 401, path); assert.equal(r.payload.error.code, 'DEMO_ACCESS_DENIED');
    assert.ok(!JSON.stringify(r.payload).includes(CODE));
  }
}));
test('12 wrong and overlong demo code rejected', withEnv({ SILKWEB_DEMO_ACCESS_CODE: CODE }, async () => {
  assert.equal(checkDemoAccess('wrong-code', { SILKWEB_DEMO_ACCESS_CODE: CODE }).status, 401);
  assert.equal(checkDemoAccess('x'.repeat(129), { SILKWEB_DEMO_ACCESS_CODE: CODE }).status, 401);
  assert.equal(demoCodeFromHeader(['a', 'b']), undefined);
  const r = await call('POST', '/api/image-ads/jobs', { headers: { 'x-silkweb-demo-code': 'wrong-code' }, body: paidBody });
  assert.equal(r.status, 401);
}));
test('13 correct demo code accepted past auth (provider off, no paid call)', withEnv({ SILKWEB_DEMO_ACCESS_CODE: CODE }, async () => {
  assert.deepEqual(checkDemoAccess(CODE, { SILKWEB_DEMO_ACCESS_CODE: CODE }), { ok: true });
  for (const path of ['/api/image-ads/jobs', '/api/image-ads/generate-live']) {
    const r = await call('POST', path, { headers: goodHeaders, body: paidBody });
    assert.equal(r.status, 503, path); assert.equal(r.payload.error.code, 'PROVIDER_UNAVAILABLE', path);
  }
  assert.equal(demoJobCap.acceptedCount, 0);
}));
test('14 env unset or empty disables paid generation fail-closed', withEnv({}, async () => {
  assert.equal(checkDemoAccess(CODE, {}).status, 503);
  assert.equal(checkDemoAccess(CODE, { SILKWEB_DEMO_ACCESS_CODE: '' }).code, 'DEMO_GENERATION_UNAVAILABLE');
  for (const path of ['/api/image-ads/jobs', '/api/image-ads/generate-live']) {
    const r = await call('POST', path, { headers: goodHeaders, body: paidBody });
    assert.equal(r.status, 503, path); assert.equal(r.payload.error.code, 'DEMO_GENERATION_UNAVAILABLE', path);
  }
}));
test('15 legacy and jobs routes share cap; excess rejected before paid work', withEnv({ SILKWEB_DEMO_ACCESS_CODE: CODE, SILKWEB_MAX_DEMO_JOBS: '1' }, async () => {
  const cap = new DemoJobCap({ maxJobs: 2 });
  assert.ok(cap.tryAcquire()); assert.ok(cap.tryAcquire()); assert.ok(!cap.tryAcquire());
  cap.release(); assert.ok(cap.tryAcquire()); assert.equal(resolveMaxDemoJobs({}), 3); assert.equal(resolveMaxDemoJobs({ SILKWEB_MAX_DEMO_JOBS: '5' }), 5);
  assert.ok(demoJobCap.tryAcquire());
  for (const path of ['/api/image-ads/jobs', '/api/image-ads/generate-live']) {
    const r = await call('POST', path, { headers: goodHeaders, body: paidBody });
    assert.equal(r.status, 503, path); assert.equal(r.payload.error.code, 'DEMO_JOB_LIMIT_REACHED', path);
  }
  assert.equal(demoJobCap.acceptedCount, 1);
}));
test('16 polling never invokes paid generation and unknown job is 404', withEnv({ SILKWEB_DEMO_ACCESS_CODE: CODE }, async () => {
  const before = demoJobCap.acceptedCount;
  const r = await call('GET', '/api/image-ads/jobs/00000000-0000-4000-8000-000000000000');
  assert.equal(r.status, 404); assert.equal(r.payload.error.code, 'JOB_NOT_FOUND');
  assert.equal(demoJobCap.acceptedCount, before);
}));
test('17 public read-only endpoints remain available without code', withEnv({}, async () => {
  for (const path of ['/api/health', '/api/config']) { const r = await call('GET', path); assert.equal(r.status, 200, path); assert.ok(!JSON.stringify(r.payload).includes('SILKWEB_DEMO_ACCESS_CODE')); }
}));
test('18 frontend sends code only as header, never stored or in payload', () => {
  const html = readFileSync(new URL('../public/creative.html', import.meta.url), 'utf8');
  assert.ok(html.includes('id="demo-access-code"')); assert.ok(html.includes('type="password"')); assert.ok(html.includes('maxlength="128"'));
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.ok(app.includes("'x-silkweb-demo-code': demoAccessCode")); assert.ok(app.includes("$('#demo-access-code').value"));
  assert.ok(!app.includes('localStorage')); assert.ok(!app.includes('sessionStorage')); assert.ok(!app.includes('document.cookie'));
  assert.ok(!app.includes('demoAccessCode:')); assert.ok(app.includes('DEMO_JOB_LIMIT_REACHED')); assert.ok(app.includes('Missing or invalid demo access code'));
  const serverSrc = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
  assert.ok(serverSrc.includes('timingSafeEqual') || readFileSync(new URL('../src/demoAccess.ts', import.meta.url), 'utf8').includes('timingSafeEqual'));
  assert.ok(!serverSrc.includes('Access-Control-Allow-Origin'));
});
