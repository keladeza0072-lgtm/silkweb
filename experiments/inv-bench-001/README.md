# INV-BENCH-001 — paired inventory application benchmark

**Status:** B/C authoring and measured comparison have NOT run. This branch
contains only deterministic preparation, a frozen task, a held-out evaluator
and CI calibration. The immutable, six-certified-component baseline is the
annotated tag \`inventory-cert-6-freeze\` pointing to
\`985e4d3a52c0d5f91fc946743e1c637775aec251\`.

## Question being measured

When Muse Spark 1.3/high builds the SAME real inventory allocation HTTP
application, do verified reusable components from Silk Web change:
- **quality:** 20 independent black-box HTTP tests (0–100);
- **coding time:** actual Muse coding wall-clock seconds (not evaluator runtime);
- **inference usage:** final cumulative Muse input, cached, output and reasoning tokens;
- **measured credits:** before/after balance observations per run, not guessed cost;
- **reuse:** audited verified MCP source retrieval, exact matching source bytes
  and static application imports, as independent evidence.

There is NO current claim that Silk Web improves quality, time or cost for
inventory. Single-pair observations are descriptive, not causal estimates.

## Conditions and fairness

Both B and C get:
- the **identical** task file \`TASK.md\` byte-for-byte;
- identical initial Git commits, same neutral TypeScript/Node 24 package
  files and pinned dependency versions;
- the same Muse model, reasoning, prompt, max step and tool policies;
- no evaluator or source solutions in their candidate directory.

B has **no** MCP server. C alone exposes the six-component, verified-only
Silk Web MCP Librarian. Both receive the SAME instructions to use verified
Silk Web components **only if the tools are present**; B implements from
scratch when absent. This is **explicitly assisted reuse** rather than
proof of autonomous default adoption. Do not confuse compiling a candidate
with exercising inventory logic: real HTTP and concurrent requests are
independently executed from the operator folder.

The protected real components and evidence are read-only to Muse. The
shared task forbids other candidate worktrees, evaluation sources, model
audit logs and unbounded external context.

## One-time offline preparation — NO model inference

1. In a NEW clone or worktree of \`experiment/inv-bench-001\`, build
   \`packages/registry\` and \`apps/mcp-server\` with \`npm.cmd ci\`
   followed by \`npm.cmd run build\`. Existing evidence must validate.
2. From the source worktree: \`node experiments/inv-bench-001/prepare.mjs\`.
   The script exits if the output folder exists, registry trust is invalid,
   source worktree is dirty, or the six-component tag is not ancestral.
3. Workspaces are separate:
   \`$HOME/Projects/inv-bench-001-20261030/B\` and \`.../C\`.
4. Run \`npm.cmd ci\` in both neutral starter directories. STOP.

A 20/20 CI calibration uses a **known-good operator-only adapter** to
verify the black-box evaluator itself; that reference adapter is not
copied into either Muse workspace. The benchmark evaluator has no
test-specific dependency on the candidate's source layout except the
required compiled \`dist/server.js\` entrypoint.

## Paid Muse sessions, explicit approval/steps

Run B first (WITHOUT Silk Web), inspect credits, then C (WITH Silk Web):

    powershell.exe -NoProfile -ExecutionPolicy Bypass -File experiments\inv-bench-001\run.ps1 -Condition B -MaxModelSteps 55
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File experiments\inv-bench-001\run.ps1 -Condition C -MaxModelSteps 55

These are two independent billable Muse sessions. There is no hard
dollar cap implied by \`MaxModelSteps\`. You should record credit balance
immediately before/after each run if reporting approximate deltas. No
automatic retries or silent score adjustments are allowed. Run failures
and original model usage logs are preserved, never overwritten.

## Read-only post-run comparison

    node experiments/inv-bench-001/analyze.mjs

This emits a descriptive paired score, coding runtime and token summary;
it also checks C's audited \`get_verified_component_source\` retrieval
and byte-exact application integration. The tool invocation by itself
never proves reuse. A missing verified source match is recorded as
\`verifiedReuseProven:false\` even if C's HTTP app performs well.

The 20-check scorer and task are frozen **before** any billable coding.
If the evaluator has a contract bug, disclose an explicit separately
versioned correction and retain both original and corrected scores,
following the INV07-v2 precedent; do NOT quietly change the original.

No existing Muse run artifacts, frozen demo tags, or historical RES-002
scores are overwritten.
