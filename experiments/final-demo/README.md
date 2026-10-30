# SILKWEB-DEMO-001 — final Muse-powered product demonstration

A single **guided product demo**, not a controlled A/B benchmark. It demonstrates:

1. Muse Spark 1.3 uses the certified-only MCP search and contract inspection.
2. Muse runs the verified installer and inspects the exact SHA-256 provenance report.
3. Muse integrates the source into an HTTP booking API and writes behavioral tests.
4. The operator runs Phase 3 (certification + build + entry import + selected tests).
5. A separate evaluator probes live HTTP behavior with a fresh database.

No prior benchmark, held-out evaluator, certified source or registry evidence is altered.

## Offline preparation (ZERO model calls)

From an independent Git worktree based on feature/final-muse-demo,
build/check packages/registry and apps/mcp-server first. Then:

    cd experiments/final-demo
    node prepare.mjs

Preparation writes only to this new location:

    $HOME/Projects/silkweb-final-demo-20261030/candidate
    $HOME/Projects/silkweb-final-demo-20261030/operator

The source checkout is never a Muse candidate. The fresh starter is a
Git-initialized and frozen blank HTTP server. Prepared outputs are never
overwritten by another preparation.

Then install the candidate's dependencies (NO model calls):

    cd "$HOME\Projects\silkweb-final-demo-20261030\candidate"
    npm.cmd ci

At this point STOP. Do not run the billable session until separately
reviewing the budget and authorizing one model call campaign.

## Explicit, paid Muse call (later)

The operator can separately invoke the one-shot runner:

    powershell -NoProfile -ExecutionPolicy Bypass -File experiments\final-demo\run.ps1 -MaxModelSteps 30

This is not invoked by preparation or CI. Maximum model steps are NOT a
hard monetary cap. The runner refuses previous run files, a dirty starter,
changed frozen source/prompt hashes, missing auth, and absent dependencies.
It does not retry automatically.

Run records are created under the operator folder, outside the repository.
They contain Muse JSONL output, MCP audit, Phase 3 report, independent HTTP
assessment and immutable trial metadata. NEVER publish raw JSONL or
authentication files; Studio must display sanitized metadata only.

## Assurance

An integration-verified claim requires the Phase 3 target build, source
integrity, static entry reachability and the explicitly named application
test to pass. Operator-only runtime checks separately exercise booking,
replay, conflict, cancellation and invalid input. They do not prove
untested correctness or production security.

This is a guided demonstration, not evidence of autonomous default Muse
adoption or a second cost/speed A/B. RES-002 remains the frozen controlled
comparison with its documented single-pair limitations.

Neither the demo runner nor this documentation should be read as permission
to spend credits: the operator launches the paid session separately.
