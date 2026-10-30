import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  checkBookingApp,
  createApproval,
  discoverStudioRepoRoot,
  getContract,
  getVerification,
  listApprovals,
  listCapabilities,
  resolveDataFile,
  searchComponents,
} from '../dist/service.js';

/**
 * Studio suite. Uses disposable app-local fixtures only:
 * - approvals go to tests/tmp/approvals-*.json (never the real data file)
 * - the uncertified-component fixture is a temp manifest dir (never real manifests)
 * Real certification evidence is only ever READ, never edited.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const tmpDir = join(here, 'tmp');
const dataFile = join(tmpDir, `approvals-${process.pid}.json`);
const fixtureManifestDir = join(tmpDir, `manifests-${process.pid}`);

const SLOT_GUARD = { id: 'booking-slot-guard', version: '0.1.0' };
const REQUIREMENT = 'Prevent double-booking for a barbershop using fixed 30-minute appointment slots.';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function freshDataFile() {
  rmSync(dataFile, { force: true });
}

before(() => {
  mkdirSync(tmpDir, { recursive: true });
  freshDataFile();
});

after(() => {
  rmSync(dataFile, { force: true });
  rmSync(fixtureManifestDir, { recursive: true, force: true });
});

test('3. contract displays the exact certified dependencies and invariants', async () => {
  const contract = await getContract(SLOT_GUARD.id, SLOT_GUARD.version);
  assert.equal(contract.trusted, true);
  assert.deepEqual(contract.dependencies, [
    { id: 'booking-schema', version: '0.1.0' },
    { id: 'booking-validation', version: '0.1.0' },
  ]);
  const manifest = readJson(join(repoRoot, 'registry-data', 'manifests', 'booking-slot-guard-0.1.0.json'));
  assert.deepEqual(contract.invariants, manifest.invariants);
  assert.deepEqual(contract.capabilities, manifest.capabilities);
  assert.equal(contract.runtime.stack, 'node24+sqlite');
  assert.equal(contract.verification.sourceHash, manifest.verification.sourceHash);
  assert.ok(contract.invariants.some((i) => i.includes('30 minutes')), 'fixed-30-minute constraint must be shown');
  assert.ok(
    contract.invariants.some((i) => i.toLowerCase().includes('sequential same-process')),
    'same-process concurrency limitation must be shown',
  );
});

test('4. approval requires explicit acknowledgment of limitations', async () => {
  freshDataFile();
  await assert.rejects(
    () =>
      createApproval(
        { requirementText: REQUIREMENT, capability: 'slot-guard', id: SLOT_GUARD.id, version: SLOT_GUARD.version, acknowledgedLimitations: false },
        { dataFile },
      ),
    (error) => error.code === 'ACKNOWLEDGMENT_REQUIRED',
  );
  assert.ok(!existsSync(dataFile), 'no approval file may be created without acknowledgment');
});

test('5. a valid approval persists the exact component identity and evidence fingerprint', async () => {
  freshDataFile();
  const view = await createApproval(
    { requirementText: REQUIREMENT, capability: 'slot-guard', id: SLOT_GUARD.id, version: SLOT_GUARD.version, acknowledgedLimitations: true },
    { dataFile },
  );
  assert.equal(view.stale, false);
  assert.equal(view.componentId, SLOT_GUARD.id);
  assert.equal(view.componentVersion, SLOT_GUARD.version);
  assert.equal(view.requirementText, REQUIREMENT);
  assert.ok(view.approvedAt);

  const manifest = readJson(join(repoRoot, 'registry-data', 'manifests', 'booking-slot-guard-0.1.0.json'));
  const evidence = readJson(join(repoRoot, 'registry-data', 'evidence', 'booking-slot-guard-0.1.0.json'));
  assert.equal(view.sourceHash, manifest.verification.sourceHash);
  assert.equal(view.artifactFingerprint, evidence.artifactFingerprint);

  const stored = readJson(dataFile);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].sourceHash, manifest.verification.sourceHash);
  assert.equal(stored[0].artifactFingerprint, evidence.artifactFingerprint);
  assert.equal(stored[0].componentId, SLOT_GUARD.id);
});

test('6. an approval becomes stale when evidence or the selected identity changes', async () => {
  freshDataFile();
  await createApproval(
    { requirementText: REQUIREMENT, capability: 'slot-guard', id: SLOT_GUARD.id, version: SLOT_GUARD.version, acknowledgedLimitations: true },
    { dataFile },
  );

  // 6a. Tampered evidence fingerprint -> stale.
  let stored = readJson(dataFile);
  stored[0].artifactFingerprint = '0'.repeat(64);
  writeFileSync(dataFile, JSON.stringify(stored, null, 2));
  let listed = await listApprovals({ dataFile });
  assert.equal(listed.approvals.length, 1);
  assert.equal(listed.approvals[0].stale, true);
  assert.ok(listed.approvals[0].staleReason.toLowerCase().includes('fingerprint'));

  // 6b. Changed identity (unknown component) -> stale, never current.
  stored = readJson(dataFile);
  stored[0].componentId = 'no-such-component';
  stored[0].artifactFingerprint = '0'.repeat(64);
  writeFileSync(dataFile, JSON.stringify(stored, null, 2));
  listed = await listApprovals({ dataFile });
  assert.equal(listed.approvals[0].stale, true);

  // Restore one fresh, current approval for the verification test below.
  freshDataFile();
  const view = await createApproval(
    { requirementText: REQUIREMENT, capability: 'slot-guard', id: SLOT_GUARD.id, version: SLOT_GUARD.version, acknowledgedLimitations: true },
    { dataFile },
  );
  assert.equal(view.stale, false);
});

test('7. verification shows real passing evidence and the recorded limitations', async () => {
  const view = await getVerification(SLOT_GUARD.id, SLOT_GUARD.version, { dataFile });
  assert.equal(view.found, true);
  assert.equal(view.certified, true);
  assert.ok(view.contract);
  assert.equal(view.contract.trusted, true);
  assert.equal(view.validation.valid, true);
  assert.equal(view.validation.code, 'OK');

  const evidence = view.contract.evidence;
  assert.equal(evidence.outcome, 'pass');
  assert.ok(!Number.isNaN(Date.parse(evidence.executedAt)), 'executedAt must be a real timestamp');
  assert.ok(typeof evidence.testCommand === 'string' && evidence.testCommand.length > 0);
  assert.ok(Array.isArray(evidence.testFiles) && evidence.testFiles.length > 0);
  assert.ok(String(evidence.nodeVersion).startsWith('v'));
  assert.ok(typeof evidence.sqliteVersion === 'string' && evidence.sqliteVersion.length > 0);
  assert.ok(typeof evidence.sourceHash === 'string' && evidence.sourceHash.length === 64);
  assert.ok(typeof evidence.artifactFingerprint === 'string' && evidence.artifactFingerprint.length === 64);
  assert.ok(
    evidence.limitations.toLowerCase().includes('sequential same-process'),
    'recorded concurrency limitation must be shown',
  );

  const current = view.approvals.filter((a) => !a.stale);
  assert.ok(view.approvals.length >= 1, 'the recorded approval must be attached');
  assert.ok(current.length >= 1, 'the recorded approval must still match current evidence');
});

test('8. invalid or missing evidence never appears as valid certification', async () => {
  // Unknown identity: not found, never certified, no contract.
  const missing = await getVerification('no-such-component', '9.9.9', { dataFile });
  assert.equal(missing.found, false);
  assert.equal(missing.certified, false);
  assert.equal(missing.contract, null);

  await assert.rejects(() => getContract('no-such-component', '9.9.9'), (error) => error.code === 'NOT_FOUND');
  await assert.rejects(() => getContract('../escape', '0.1.0'), (error) => error.code === 'INVALID_IDENTITY');

  // The booking probe reports only what it actually checked. All probes
  // below are deterministic in-process stubs — no sockets, no network.
  const seen = [];
  const failingProbe = async (healthUrl, timeoutMs) => {
    seen.push([healthUrl, timeoutMs]);
    throw new Error('connection refused');
  };
  const down = await checkBookingApp('http://127.0.0.1:3000', 500, failingProbe);
  assert.equal(down.running, false);
  assert.equal(down.url, 'http://127.0.0.1:3000');
  assert.deepEqual(seen, [['http://127.0.0.1:3000/api/health', 500]]);

  const errorStatus = await checkBookingApp('http://127.0.0.1:3000', 500, async () => ({ ok: false, status: 500 }));
  assert.equal(errorStatus.running, false);
  assert.equal(errorStatus.status, 500);

  const up = await checkBookingApp('http://127.0.0.1:3000', 500, async () => ({ ok: true, status: 200 }));
  assert.equal(up.running, true);
  assert.equal(up.status, 200);
});

test('9. existing registry/MCP/booking-app functionality remains unchanged', async () => {
  // The trust gate serves all five currently certified components, including V2.
  const result = await searchComponents({});
  assert.equal(result.totalTrusted, 5);
  assert.deepEqual(result.rejected, []);
  const ids = result.components.map((c) => `${c.id}@${c.version}`).sort();
  assert.deepEqual(ids, [
    'booking-reservation-kernel@0.2.0',
    'booking-schema@0.1.0',
    'booking-slot-guard@0.1.0',
    'booking-validation@0.1.0',
    'registry-loader@0.1.0',
  ]);

  const caps = await listCapabilities();
  assert.ok(caps.capabilities.includes('slot-guard'));

  // Studio writes stay app-local: the default data file and any override
  // must resolve under apps/studio/, and registry paths are refused.
  const root = discoverStudioRepoRoot();
  assert.ok(resolveDataFile(root).replace(/\\/g, '/').endsWith('apps/studio/data/approvals.json'));
  assert.throws(() => resolveDataFile(root, '../../packages/registry/evil.json'), (error) => error.code === 'UNSAFE_PATH');
});

test('10. HTTP routes serve the API without a listening socket', async () => {
  const { handleApi, serveStatic } = await import('../dist/server.js');

  function fakeExchange(method, bodyText) {
    let status = 0;
    let text = '';
    const req = {
      method,
      on(event, cb) {
        if (event === 'data' && bodyText !== undefined) queueMicrotask(() => cb(Buffer.from(bodyText)));
        if (event === 'end') queueMicrotask(() => cb());
        return this;
      },
    };
    const res = {
      writeHead(s) { status = s; },
      end(b) { text = Buffer.from(b).toString('utf8'); },
    };
    return { req, res, result: () => ({ status, text, json: text ? JSON.parse(text) : null }) };
  }

  async function get(path) {
    const ex = fakeExchange('GET');
    const handled = await handleApi(ex.req, ex.res, new URL(`http://127.0.0.1${path}`));
    return { handled, ...ex.result() };
  }

  const health = await get('/api/health');
  assert.equal(health.handled, true);
  assert.equal(health.status, 200);
  assert.equal(health.json.ok, true);

  const search = await get('/api/search?capability=slot-guard');
  assert.equal(search.status, 200);
  assert.ok(search.json.components.some((c) => c.id === 'booking-slot-guard'));

  const missingParam = await get('/api/contract?id=booking-slot-guard');
  assert.equal(missingParam.status, 400);

  const unknownComponent = await get('/api/verification?id=no-such-component&version=9.9.9');
  assert.equal(unknownComponent.status, 404);
  assert.equal(unknownComponent.json.verification.found, false);
  assert.equal(unknownComponent.json.verification.certified, false);

  const post = fakeExchange(
    'POST',
    JSON.stringify({ requirementText: 'Need slot-guard.', capability: 'slot-guard', id: 'booking-slot-guard', version: '0.1.0', acknowledgedLimitations: false }),
  );
  const postHandled = await handleApi(post.req, post.res, new URL('http://127.0.0.1/api/approvals'));
  assert.equal(postHandled, true);
  assert.equal(post.result().status, 400);
  assert.equal(post.result().json.error.code, 'ACKNOWLEDGMENT_REQUIRED');

  const unknownRoute = await get('/api/nope');
  assert.equal(unknownRoute.handled, false);

  const index = serveStatic('/');
  assert.ok(index && index.status === 200 && index.type.includes('text/html'));
  const appJs = serveStatic('/app.js');
  assert.ok(appJs && appJs.type.includes('javascript'));
  assert.equal(serveStatic('/../package.json'), null);
  assert.equal(serveStatic('/etc/passwd'), null);
});

test('1. requirements search finds booking-slot-guard through capability matching', async () => {
  const result = await searchComponents({ capabilities: ['slot-guard'] });
  const found = result.components.find((c) => c.id === SLOT_GUARD.id && c.version === SLOT_GUARD.version);
  assert.ok(found, 'booking-slot-guard@0.1.0 must be returned for capability slot-guard');
  assert.ok(found.capabilities.includes('slot-guard'));
  assert.equal(found.certificationEligible, true);
  assert.ok(result.deterministicNote.toLowerCase().includes('deterministic'));
  assert.ok(result.deterministicNote.toLowerCase().includes('not semantic'));
});

test('2. requirements search never presents uncertified components as trusted', async () => {
  // 2a. A nonsense capability matches nothing trusted.
  const empty = await searchComponents({ capabilities: ['no-such-capability-xyz'] });
  assert.equal(empty.components.length, 0);

  // 2b. A fixture manifest declaring unverified status is rejected, not served.
  const schemaManifest = readJson(join(repoRoot, 'registry-data', 'manifests', 'booking-schema-0.1.0.json'));
  const ghost = { ...schemaManifest, id: 'fixture-ghost', version: '0.1.0' };
  ghost.verification = { ...schemaManifest.verification, status: 'unverified' };
  rmSync(fixtureManifestDir, { recursive: true, force: true });
  mkdirSync(fixtureManifestDir, { recursive: true });
  writeFileSync(join(fixtureManifestDir, 'fixture-ghost-0.1.0.json'), JSON.stringify(ghost, null, 2));

  const prevManifestDir = process.env.SILKWEB_MANIFEST_DIR;
  const prevRepoRoot = process.env.SILKWEB_REPO_ROOT;
  process.env.SILKWEB_REPO_ROOT = repoRoot;
  process.env.SILKWEB_MANIFEST_DIR = fixtureManifestDir;
  try {
    const result = await searchComponents({});
    assert.ok(!result.components.some((c) => c.id === 'fixture-ghost'), 'unverified fixture must not be listed');
    const rejected = result.rejected.find((r) => r.id === 'fixture-ghost');
    assert.ok(rejected, 'unverified fixture must appear in rejected');
    assert.equal(rejected.code, 'UNVERIFIED');
  } finally {
    if (prevManifestDir === undefined) delete process.env.SILKWEB_MANIFEST_DIR;
    else process.env.SILKWEB_MANIFEST_DIR = prevManifestDir;
    if (prevRepoRoot === undefined) delete process.env.SILKWEB_REPO_ROOT;
    else process.env.SILKWEB_REPO_ROOT = prevRepoRoot;
  }
});
