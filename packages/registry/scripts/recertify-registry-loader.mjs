/**
 * Certify the published registry-loader after the five-component catalog
 * test was updated. This NEVER edits source or changes the certified
 * loader source hash. No speculative evidence: run the allowlisted test
 * command, stage actual evidence, validate it, then optionally promote.
 *
 * From packages/registry after "npm run build":
 *   node scripts/recertify-registry-loader.mjs
 *   node scripts/recertify-registry-loader.mjs --promote
 */
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadRegistry, runVerification, validateComponent,
} from '../dist/index.js';

const args = process.argv.slice(2);
if (args.some(x => x !== '--promote') || args.length > 1) {
  throw new Error('supported usage: no flags (stage) or --promote');
}
const promote = args.includes('--promote');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const manifestRel = 'registry-data/manifests';
const evidenceRel = 'registry-data/evidence';
const stageRel = 'packages/registry/tests/tmp/loader-v2-recertification';
const evidenceFile = join(root, evidenceRel, 'registry-loader-0.1.0.json');
const stageDir = join(root, stageRel);
const manifests = loadRegistry(join(root, manifestRel));
assert.deepEqual(manifests.map(m => m.id).sort(), [
  'booking-reservation-kernel',
  'booking-schema',
  'booking-slot-guard',
  'booking-validation',
  'registry-loader',
]);
assert.ok(manifests.every(m => m.verification.status === 'verified'),
  'all active manifests must remain declaratively verified');
const loader = manifests.find(m => m.id === 'registry-loader');
assert.ok(loader && loader.version === '0.1.0', 'published loader manifest not found');

rmSync(stageDir, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });
process.stdout.write('RUN registry-loader@0.1.0 [registry:loader-tests]\n');
const observed = runVerification(root, loader, manifests, {
  commandKey: 'registry:loader-tests',
  evidenceDir: stageRel,
  timeoutMs: 120000,
});
assert.equal(observed.passed, true, 'real loader test suite did not pass');
assert.equal(observed.evidence.outcome, 'pass');
assert.equal(observed.evidence.exitCode, 0);
assert.equal(observed.evidence.sections.sources, loader.verification.sourceHash,
  'historical loader source hash changed; do not certify');

const stagedManifest = {
  ...loader,
  verification: { ...loader.verification, status: 'unverified' },
};
const staged = validateComponent(root, stagedManifest, manifests, { evidenceDir: stageRel });
assert.equal(staged.valid, true, 'staged evidence invalid: ' + staged.code + ': ' + staged.reason);
process.stdout.write('PASS staged: executable loader tests, unchanged source hash, and evidence validation\n');

if (!promote) {
  process.stdout.write('STAGED ONLY. Published evidence left intact.\n');
  process.exit(0);
}
const original = readFileSync(evidenceFile);
try {
  copyFileSync(observed.evidencePath, evidenceFile);
  for (const manifest of manifests) {
    const validation = validateComponent(root, manifest, manifests, { evidenceDir: evidenceRel });
    if (!validation.valid) {
      throw new Error(manifest.id + '@' + manifest.version + ': ' +
        validation.code + ': ' + validation.reason);
    }
  }
  const finalEvidence = JSON.parse(readFileSync(evidenceFile, 'utf8'));
  assert.equal(finalEvidence.artifactFingerprint, observed.evidence.artifactFingerprint);
  process.stdout.write('PROMOTED: real registry-loader evidence refreshed; ALL FIVE active components validate\n');
} catch (error) {
  writeFileSync(evidenceFile, original);
  throw error;
}
