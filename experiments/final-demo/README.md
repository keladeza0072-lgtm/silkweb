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

## Windows PowerShell 5.1 reporting correction (offline)

The original frozen runner uses PowerShell native stdout redirection (1>).
Under Windows PowerShell 5.1 this may write verifier JSON as UTF-16LE with a
BOM. The original evaluator incorrectly reads this file as UTF-8. It may
report 18/19 even when Muse, the build, and Phase 3 all exited successfully.

Do not rerun Muse or overwrite the original run.json, evaluation.json,
phase3-verification.json, or immutable target-side validation report.

Use a separate checkout of fix/final-demo-report-reconciliation and run:

    node experiments/final-demo/reconcile.mjs

The script locates prior artifacts at:

    $HOME/Projects/silkweb-final-demo-20261030

Before creating an additive reconciliation record, it checks:

- The one original completed guided trial and exact 18/19 evaluation failure.
- The reason is exclusively a UTF-16LE CLI stdout decoding mismatch.
- Actual Phase 3 status integration-verified, correct app entry and named tests.
- Exact certification, installed source hashes and passing test counts.
- Matching CLI output and the immutable target-side Phase 3 report.

Only then it exclusively creates operator/evaluation-reconciliation.json.
It never invokes Muse, reruns tests, overwrites the original, or modifies
application files. A mismatch fails closed without asserting success.

Studio shows offline-reconciled results only when source-report digests still
match. The original 18/19 result remains visible in the explanatory note.
This is a reporting correction, NOT a second benchmark or paid model call.
