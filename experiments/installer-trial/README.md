# MUSE-INSTALL-001 — Muse Spark 1.3 + verified installer adoption

**Status: prepared for a single guided paid trial; not a benchmark.**

This experiment closes the Phase 1 demo gap without changing any RES-002
evidence, certificates or earlier adoption runs. It uses:

- Meta Muse Spark 1.3 (high) as the coding agent.
- The original read-only Silk Web MCP server for `search_verified_components`
  and `inspect_verified_component`, audited outside the candidate.
- The new `packages/installer/bin/silkweb.mjs` CLI for verified source
  delivery, without retrieving 19KB+ of source into Muse's prompt.
- A completely separate starter target under
  `$HOME/Projects/muse-installer-trial-20261029/candidate`.
- One frozen task prompt, one saved session, no retries or A/B claims.

## Step 1 — New trial worktree (PowerShell)

```powershell
cd "$HOME\Projects\silkweb-v2"
git fetch origin experiment/muse-installer-adoption
git worktree add -b muse-installer-trial "$HOME\Projects\silkweb-installer-trial" origin/experiment/muse-installer-adoption
```

If the named local branch already exists, **do not reset it**. Inspect first.
Never use the previous benchmark worktrees as a target.

## Step 2 — Local prerequisites; ZERO paid model calls

```powershell
$repo = "$HOME\Projects\silkweb-installer-trial"
cd "$repo\packages\registry"
npm.cmd ci
npm.cmd run check
if ($LASTEXITCODE -ne 0) { throw "Registry checks failed" }
cd "$repo\apps\mcp-server"
npm.cmd ci
npm.cmd run check
if ($LASTEXITCODE -ne 0) { throw "MCP checks failed" }
cd "$repo\packages\installer"
npm.cmd run check
if ($LASTEXITCODE -ne 0) { throw "Installer checks failed" }

cd $repo
node experiments/installer-trial/prepare.mjs
if ($LASTEXITCODE -ne 0) { throw "Trial preflight failed" }

$target = "$HOME\Projects\muse-installer-trial-20261029\candidate"
cd $target
npm.cmd ci
if ($LASTEXITCODE -ne 0) { throw "Candidate setup failed" }
```

`prepare.mjs` refuses existing trial output and checks branch cleanliness.
It copies existing authorization from a prior isolated local Muse profile,
if available; secrets are never printed or committed. No Muse call yet.

## Step 3 — Credit checkpoint, then ONE billable Muse invocation

Before running, verify available Meta credits and account limits using your
existing provider account interface. The runner records Muse's actual usage.
`--max-model-steps` bounds steps **but is not a hard spending cap**.

```powershell
$repo = "$HOME\Projects\silkweb-installer-trial"
& "$repo\experiments\installer-trial\run.ps1" -MaxModelSteps 20
```

The runner refuses a modified source tree, changed frozen prompt, changed
candidate baseline, absent authentication, missing builds, or any existing
run outputs. It never automatically retries. Muse's JSONL and audit logs
are stored in `$HOME/Projects/muse-installer-trial-20261029/operator`.

The evaluator runs locally after the model returns. If any check fails, keep
all artifacts unchanged and diagnose that one attempt; do not repeat silently.

## What the local evaluator checks

- Real MCP search finds the certified kernel, followed by inspection.
- **Zero** calls to `get_verified_component_source`.
- Target installer report exists, references the correct certification evidence,
  records the correct artifact/source fingerprints and component closure.
- Four installed source files have SHA-256 hashes exactly equal to the original
  certified registry files and audit report.
- Muse's adapter imports the installed kernel and uses its functions.
- The Muse-written probe builds and executes a booking / idempotency / cancellation scenario.
- An independent Node process tests the installed compiled kernel behavior.
- Total model tokens, cached/uncached input tokens, output tokens, coding time,
  and directly reported cost if available are captured without causal claims.

**Limitations:** This is guided adoption on one isolated task. It does not
establish automatic/unprompted tool selection, production runtime safety,
inference savings, statistical significance, or comparative speed/quality.
Keep RES-002 as the original independent A/B proof. No paid Muse calls are
made during setup, CI, validation or static evaluation.
