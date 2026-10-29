/**
 * Local, no-model-cost V2 certification utility.
 *
 * Default: run all five real allowlisted verification commands and stage
 * machine-generated evidence under gitignored tests/tmp/, touching no
 * tracked evidence or active registry manifests.
 *
 * --promote: only after ALL five test runs and staged validations pass,
 * replace V1 certification records ON THE CURRENT DEV BRANCH and publish
 * V2 manifest + V2 evidence to the active registry. Roll back tracked
 * evidence/manifest contents if post-promotion validation fails.
 *
 * The historical mvp-freeze tag and any benchmark evidence remain untouched.
 */
import assert from 'node:assert/strict';
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadRegistry, manifestSchema, runVerification, validateComponent,
} from '../dist/index.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const activeDir = join(repoRoot, 'registry-data/manifests');
const evidenceDir = join(repoRoot, 'registry-data/evidence');
const candidateFile = join(repoRoot, 'registry-data/candidates/booking-reservation-kernel-0.2.0.json');
const activeV2File = join(activeDir, 'booking-reservation-kernel-0.2.0.json');
const stageRel = 'packages/registry/tests/tmp/reservation-v2-certification';
const stageDir = join(repoRoot, stageRel);
const canonicalEvidenceRel = 'registry-data/evidence';
const promote = process.argv.slice(2).includes('--promote');
if (process.argv.slice(2).some(arg => arg !== '--promote')) {
  throw new Error('only supported flag is --promote');
}
if (existsSync(activeV2File)) {
  throw new Error('V2 already exists in active registry; inspect its evidence before attempting recertification');
}

const current = loadRegistry(activeDir);
assert.equal(current.length, 4, 'expected exactly four existing certified manifests');
assert.ok(current.every(m => m.verification.status === 'verified'), 'existing manifests must be certified');
const candidate = manifestSchema.parse(JSON.parse(readFileSync(candidateFile, 'utf8')));
assert.equal(candidate.id, 'booking-reservation-kernel');
assert.equal(candidate.version, '0.2.0');
assert.equal(candidate.verification.status, 'unverified');
const all = [...current, candidate];
const components = [
  ['booking-schema', 'registry:booking-tests'],
  ['booking-validation', 'registry:booking-tests'],
  ['booking-slot-guard', 'registry:booking-tests'],
  ['registry-loader', 'registry:loader-tests'],
  ['booking-reservation-kernel', 'registry:reservation-v2-tests'],
];

rmSync(stageDir, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });
const completed = new Map();

for (const [id, commandKey] of components) {
  const manifest = all.find(m => m.id === id);
  assert.ok(manifest, 'missing expected component ' + id);
  process.stdout.write('RUN ' + id + '@' + manifest.version + ' [' + commandKey + ']\n');
  const result = runVerification(repoRoot, manifest, all, {
    commandKey,
    evidenceDir: stageRel,
    timeoutMs: 120000,
  });
  if (!result.passed) throw new Error(id + ': actual test command failed; no promotion');
  // An unchanged V1 source must retain its historical source fingerprint.
  // In particular, CRLF checkout conversion on Windows must never silently
  // be accepted as a new V1 source hash or overwrite its original claim.
  if (id !== 'booking-reservation-kernel' &&
      manifest.verification.sourceHash !== result.evidence.sections.sources) {
    throw new Error(
      id + ': original V1 source hash differs from observed source bytes. ' +
      'Check git ls-files --eol and restore LF line endings before certification. ' +
      'No active evidence or manifest has been modified.'
    );
  }
  // Check staged evidence and full dependency/test/build scopes.
  // Mark a COPY unverified only to avoid enforcing the eventual active
  // evidence path while evidence is staged in gitignored scratch space.
  const checkManifest = {
    ...manifest,
    verification: { ...manifest.verification, status: 'unverified' },
  };
  const validation = validateComponent(repoRoot, checkManifest, all, { evidenceDir: stageRel });
  if (!validation.valid) throw new Error(id + ': staged evidence invalid: ' + validation.code + ': ' + validation.reason);
  completed.set(id, { manifest, evidence: result.evidence, stagedPath: result.evidencePath });
  process.stdout.write('PASS ' + id + ' sourceHash=' + result.evidence.sections.sources + '\n');
}

process.stdout.write('PASS: all five observed test commands and staged evidence validations\n');

if (!promote) {
  process.stdout.write('STAGED ONLY: no active manifest or tracked evidence was modified\n');
  process.stdout.write('To promote after review, run this script again with --promote\n');
  process.exit(0);
}

// Only actual passing tests may reach this point. Preserve exact original
// dev-branch evidence bytes for restoration on any post-promotion failure.
const originals = new Map();
const publishedPaths = [];
try {
  for (const [id, entry] of completed) {
    const dest = join(evidenceDir, id + '-' + entry.manifest.version + '.json');
    originals.set(dest, existsSync(dest) ? readFileSync(dest) : null);
    copyFileSync(entry.stagedPath, dest);
    publishedPaths.push(dest);
  }

  const v2Evidence = completed.get('booking-reservation-kernel').evidence;
  const verifiedV2 = manifestSchema.parse({
    ...candidate,
    verification: {
      status: 'verified',
      testCommand: candidate.verification.testCommand,
      evidence: canonicalEvidenceRel + '/booking-reservation-kernel-0.2.0.json',
      sourceHash: v2Evidence.sections.sources,
    },
  });
  writeFileSync(activeV2File, JSON.stringify(verifiedV2, null, 2) + '\n', { flag: 'wx' });

  const published = loadRegistry(activeDir);
  assert.equal(published.length, 5, 'expected five published manifests');
  for (const manifest of published) {
    const result = validateComponent(repoRoot, manifest, published, { evidenceDir: canonicalEvidenceRel });
    if (!result.valid) throw new Error(manifest.id + ': published evidence invalid: ' + result.code + ': ' + result.reason);
  }
  process.stdout.write('PROMOTED: five independently verified components accepted by current validator\n');
  process.stdout.write('Historical mvp-freeze tag unchanged. Review git diff before committing refreshed evidence.\n');
} catch (error) {
  if (existsSync(activeV2File)) rmSync(activeV2File, { force: true });
  for (const dest of publishedPaths) {
    const before = originals.get(dest);
    if (before === null) rmSync(dest, { force: true });
    else writeFileSync(dest, before);
  }
  throw error;
}
