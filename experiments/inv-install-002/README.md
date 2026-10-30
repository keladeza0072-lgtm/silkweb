# INV-INSTALL-002 — Source retrieval versus deterministic installation

**No paid Muse runs have been performed for this experiment.** This branch is
separate from the six-component certification freeze, the vNext install
implementation, and the historically frozen INV-BENCH-001 B/C candidates.

## Objective

Determine whether giving Muse Spark 1.3/high a deterministic,
provenance-preserving source installer instead of requiring the model to
reconstruct retrieved certified source changes application quality, coding
time, token consumption, observed credit decrease or exact code integrity.

This is a **different contrast** from the original INV-BENCH-001. Both
conditions have Silk Web search/inspect/source tools; only the source
delivery method changes.

| Variable | R: retrieval only | I: installer-enabled |
| --- | --- | --- |
| Muse model | Spark 1.3/high | Spark 1.3/high |
| Maximum steps | identical, initially 55 | identical, initially 55 |
| Starter Git tree/commit | identical | identical |
| Task prompt/requirements | identical | identical |
| Certified registry | identical six-component source | identical |
| MCP discovery/inspection | yes | yes |
| MCP full source retrieval | yes | yes, but prompt says prefer install |
| MCP install_verified_component | not advertised | explicitly enabled |
| Operator workspace pin | R only | I only |
| Held-out scoring | SAME 20 checks | SAME 20 checks |

The comparator tests tool availability **and resulting model behavior**, not
a deterministic ablation of language-model sampling. One observed pair does
not prove causality or statistical generalization.

## Frozen materials

- `TASK.md`: one shared app specification and conditional installation
  instructions for both runs.
- `evaluate.mjs`: **byte-identical** to the original INV-BENCH-001
  independent HTTP evaluator; expected SHA-256
  `ac10951bc1bd7254d7915e61aff1b3cf44fa138c3f3eb365bb52e87a04d40dc5`
  after normalizing checkout line endings to LF. The previously recorded
  Windows raw-byte evaluator SHA-256 was
  `b2fb7bf24638914dac2ac8a7999b40ecfde37bd51d55506874290fe7047e403b`;
  Git blob SHA-1 matches the original evaluator on both branches. Run
  records also preserve the actual local evaluator SHA-256.
- `tests/reference-server.mjs`: operator-only known-good adapter, used only
  to calibrate the original scorer to 20/20. Never copied into candidates.
- Original inventory module SHA-256:
  `3bc564618668ccfccebccff9cd8507ced3e8b445f09708fd12d8c2b11126bcf0`.
- VNext tested source base commit:
  `34bf9e8d815cd6a02e35f5654f944565003a5538`.
- R/I held-out reports and Muse logs saved **outside Git** under
  `$HOME/Projects/inv-install-002-20261030/operator`.

## Zero-credit setup

1. Create a fresh detached worktree at the experiment's exact passing commit.
   Do not mutate frozen tags or existing benchmark worktrees.
2. `cd packages/registry; npm.cmd ci; npm.cmd run build`.
3. `cd apps/mcp-server; npm.cmd ci; npm.cmd run build`.
4. `cd <experiment-source>; node experiments/inv-install-002/prepare.mjs`.
   Preparation creates two byte-identical Git starter commits and a pinned
   shared task but **makes no Muse calls**. It refuses existing output.
5. `npm.cmd ci` once in **each** of the new R and I directories.
6. Stop and confirm task digest, original evaluator digest, authentication,
   intact starter trees, and current credit balance.

CI runs 80 registry checks, original six-certificate validation, the
previous deterministic CLI and application-integration tests, the vNext
MCP safety suite and offline matched-pair and quality calibration tests.
CI does not call Muse.

## Paid protocol (operator authorizes one run at a time)

Run R first (source retrieval; installer explicitly disabled), review its
real score, model token usage and credits, then separately authorize I
(installer enabled). These are **billable** Muse sessions. Model step limits
are NOT dollar caps.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File experiments\inv-install-002\run.ps1 -Condition R -MaxModelSteps 55
powershell.exe -NoProfile -ExecutionPolicy Bypass -File experiments\inv-install-002\run.ps1 -Condition I -MaxModelSteps 55
```

The runner checks the original source commit and frozen input hashes, verifies
each neutral candidate Git commit, forbids overwrite/retry, checks distinct
MCP audit paths, and refuses I unless R completed and settings match.
After each completed Muse coding session the runner compiles from fresh
`dist/` and runs the **same** held-out 20-check evaluator.

If a candidate fails, preserve its real failure, do not silently repair or
repeat the paid run. If the evaluator contains a defect, preserve original
results and use separately versioned, disclosed offline correction.

## Read-only analysis

```powershell
node experiments/inv-install-002/analyze.mjs
```

Read-only comparison includes held-out score (0–100), elapsed coding seconds,
final cumulative Muse model usage (not double-counted), MCP source retrieval,
MCP installer action, installation audit, SHA-256 match to certified inventory
source, and static import reachability. The model/tool logs are isolated
outside the two candidate workspaces.

**Claims deliberately NOT made:**
- a copied source is certified byte-identical unless hashes match;
- installation means application behavior is verified without independent
  tests;
- an installation audit proves actual runtime calls (static import is
  weaker);
- usage token differences are the same thing as billed dollars;
- one run per condition establishes reliable efficiency improvements.

This exercise is designed to discover whether lower-context integration is a
valuable product improvement, **not** to guarantee a favorable result.
