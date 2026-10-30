# Inventory promotion — staging (NOT certified yet)

Source branch: `feature/multidomain-inventory-certification`.
Baseline: `fix/multidomain-inventory-inv07-v2`, ultimately derived
from immutable `hackathon-demo-freeze`.

## Why this is a separate step

The first Muse inventory attempt was 10/11 under the original evaluator.
Corrected INV07-v2 accepted the contract's valid zero-initial-stock input,
and verified 11/11 without rebuilding or changing the candidate.
Both reports remain under the original operator directory.

These independent checks alone DO NOT confer Silk Web registry certification.
Only a successful allowlisted registry verification with current artifact
fingerprints, real build, test-scope evidence and validated metadata can
promote the source into certified-only MCP search.

## Staging rule

Operator copies the exact `src/inventory.ts` file from the frozen Muse
candidate into `packages/registry/src/inventory.ts` on THIS new branch.
Verify SHA-256 equality before committing; do not copy private Muse auth,
full model transcripts, or mutable local database files.

Do not alter the original generated source or re-run the paid authoring task.
Keep registry manifests, source hashes and certification evidence unchanged
until test and certification wiring has been implemented and reviewed.

## Important: existing five certified components

Some existing evidence files bind the SHA-256 of the compiled registry
`runner.js` and related tooling. Extending the runner may invalidate them.
After adding the inventory allowlist, explicitly revalidate *all five*
legacy components on the new branch. Preserve old evidence in the frozen
release, and record new branch evidence as a separate certification
snapshot; never overwrite the frozen tag or misstate the historical checks.

Phase 2 here will: adapt the INV07-v2 acceptance tests to exercise the
freshly built registry source; register inventory initially UNVERIFIED;
add strict allowlisted tests/build output and execute them; record accurate
fingerprints and relevant evidence; verify existing certified components
still qualify or recertify them; only then promote inventory's declaration.

No B/C cost or performance claim follows automatically from certification.
Matched application benchmarks require a separate controlled process.
