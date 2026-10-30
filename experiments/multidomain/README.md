# SW-MULTI-001 — Silk Web six-domain expansion

**Status: experimental. The original five certified components remain authoritative.**
All work starts after the immutable `hackathon-demo-freeze` release. This branch
never edits the RES-002 evaluator, original model runs, frozen tag, or verified demo.

## Six candidate domains

| Domain | Stage | Independent proof requirement |
|---|---|---|
| Inventory reservation | Phase 1 | SQLite atomic stock, idempotency, no oversell from competing processes |
| Signed webhook inbox | Phase 1 | HMAC-SHA256, replay, composite dedupe, durable processing |
| Leased background jobs | Phase 2 | Expired lease, retries, dead-letter, multiple workers |
| Fixed-window rate limiter | Phase 2 | Strict tenant quotas, concurrency and rollover |
| Workflow state machine | Phase 2 | Allowed transitions, revisions and replay |
| Tamper-evident audit log | Phase 2 | SHA-256 chain validation, reorder/deletion with independent head anchor |

Contracts for all six are frozen under `contracts/`; the first two also have
independent held-out acceptance tests (11 inventory + 12 webhook checks).
These are **candidate specifications**, not certified registry entries or
completed benchmarks. No component should be added to trusted search until
proper repository-owned certification evidence is created and validated.

## Phase 1 authoring procedure (two independent paid Muse sessions)

Build the registry and MCP in a NEW checkout of this branch (Node.js 24+):

    cd packages/registry
    npm.cmd ci
    npm.cmd run build
    cd ../../apps/mcp-server
    npm.cmd ci
    npm.cmd run build

Offline preparation (NO model calls):

    cd ../../experiments/multidomain
    node prepare.mjs

This creates *two fresh separate Git candidates* under:

    $HOME/Projects/silkweb-multidomain-20261030/inventory
    $HOME/Projects/silkweb-multidomain-20261030/webhooks

and one operator directory holding SHA-256 pinned Muse prompts, separate
isolated credentials and independent MCP audit paths. No tests, previous
experiments or registry source are copied to the agent workspaces.

Install pinned candidate dependencies offline (not a Muse call):

    cd "$HOME\Projects\silkweb-multidomain-20261030\inventory"
    npm.cmd ci
    cd "$HOME\Projects\silkweb-multidomain-20261030\webhooks"
    npm.cmd ci

**STOP before spending credits.** Operator chooses each run individually.

One explicit billable attempt per task, from the frozen source worktree:

    powershell.exe -NoProfile -ExecutionPolicy Bypass -File experiments\multidomain\run.ps1 -Task inventory -MaxModelSteps 35
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File experiments\multidomain\run.ps1 -Task webhooks -MaxModelSteps 35

Don't invoke both by accident. The `MaxModelSteps` value is **NOT a hard
money cap**. Inspect remaining credits manually between paid runs.
No automatic retries; an existing result blocks rerunning its task.

The operator-only evaluator runs on the compiled candidate and original
frozen tests. It prints observed `checksPassed/checksTotal` and writes
`operator/evaluation-inventory.json` and `operator/evaluation-webhooks.json`.
An agent-written test does not count toward this independent score.

## Next stage: strict certification and true A/B

After inspecting results, independently reproduce behavior and correct
defects in the ORIGINAL candidate as additional, clearly recorded attempts
(never overwrite the first result). Copy passing sources into a new registry
branch, register UNVERIFIED manifests, extend the explicit certification
test/build allowlist and frozen source map, then run executable suites and
record real SHA-256-bound evidence before upgrading status to `verified`.

Only **then** prepare fresh, matched B/C application tasks where condition
B has no Silk Web MCP and condition C has the newly certified component.
Freeze task, baseline, evaluator, model, reasoning and tool policies.
Run with measured Muse usage and report actual results, including failures.
Never call a model-created component a cost-saving benchmark of Silk Web.

Initial experimental spending target: **$30 across stages**, subject to
manual review after every paid run. Credit balance is not a billing record.
Do not infer per-run dollars unless explicitly measured and attributable.

## Reproducible zero-model-call CI

`node --test experiments/multidomain/tests/offline.test.mjs` asserts six
distinct problem scopes, two clean Git candidates, zero artificial Muse
success, no overwrites, and rejection of a blank implementation. It does
not pretend any candidate passes behavioral tests before Muse writes it.

## INV07-v2: original 10/11 inventory acceptance bug

Original INV-001 contract requires **nonnegative** initial stock (zero valid).
The original held-out `inventory.test.mjs` accidentally treated zero as invalid
in its INV07 `seedStock` loop. Muse's first inventory attempt produced a
successful build, 10/11 independent checks, and failed precisely that assertion.

To correct the EVALUATOR without changing original source, candidate, or run:

1. Preserve `operator/evaluation-inventory.json` (original 10/11).
2. Check out branch `fix/multidomain-inventory-inv07-v2` in a NEW worktree.
3. Run `node experiments/multidomain/reconcile-inventory-v2.mjs`.
4. Inspect exclusively created `operator/evaluation-inventory-v2.json`.

The script verifies the original run provenance, original frozen test and
contract hashes, source revision, precise original INV07 failure, and exact
compiled output SHA-256. It confirms the corrected held-out test has only
the approved one-test change; then it executes the 11 tests offline.

**DO NOT claim 11/11 until the script actually reports success.**
An original 10/11 stays original 10/11; a passing v2 may be described as
'11/11 on corrected contract-aligned held-out evaluator, after offline
reconciliation; original 10/11 preserved'. This is not registry certification,
not a new Muse run and not a controlled B/C cost or quality comparison.
