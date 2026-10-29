# RES-001 independent evaluation harness

**State: PRE-FLIGHT.** This is not a benchmark result. The evaluator
is not available to either coding agent, and the original BKG-001 assets
are untouched.

## Files

- \`../tasks/RES-001.md\`: identical functional contract for B and C
- \`../tasks/res-001-starter/\`: identical TypeScript starter + pinned lockfile
- \`res001-evaluate.mjs\`: held-out, wire-level HTTP evaluator

## Isolation

B and C receive separate copies of the starter **outside this repo**.
Neither workspace contains this evaluator, the Silk Web registry, or
the other agent's outputs. Do not give either agent direct read access
to this checkout, the evaluator path or either private report.
Condition C can access components only through the configured MCP tools.
Avoid giving the coding agents a repository URL, file path or source
snippet for Silk Web. Confirm the actual Muse sandbox and permissions
before running; directory separation alone is not a security boundary.

Run the evaluator only AFTER each agent finishes, from a separate
operator/evaluator session:

    node experiments/harness/res001-evaluate.mjs --candidate ABSOLUTE_APP_DIR --report ABSOLUTE_REPORT_JSON

Each candidate must have \`dist/server.js\` built. Reports must live
outside agent workspaces. The evaluator creates fresh file-backed SQLite
databases, launches the real HTTP service and performs checks for HTTP
format, error codes, idempotency, cancellation, strict UTC validation,
restart persistence, and two independent processes accessing one DB.

## Score and interpretation

The suite defines **41 fixed checks** with a **65-point weighted
denominator**. Missing or skipped checks fail. The reported score is
\`round(100 * earned / 65, 1)\`. Do not alter weights or tests after
freezing the evaluator hash. Record the full evaluator report, raw
session trace, command, exit code and any startup errors. A failed
candidate is not discarded. No model inference is used by this harness.

This evaluates application behavior, not provenance: source reuse must
be corroborated separately using the server-side
\`SILKWEB_AUDIT_LOG\` events, Muse session tool calls and the actual
integrated source/compiled execution. A successful tool retrieval alone
is not proof of execution.

The concurrency tests cover two Node processes using one local
SQLite file, not arbitrary load or distributed deployments. One matched
B/C pair provides an **observed** effect, not a population-level
performance claim.

## Preflight

Use \`node --check experiments/harness/res001-evaluate.mjs\`, verify
the pinned starter builds in a disposable workspace, and inspect the
Muse headless/session flags. Freeze hashes for task, starter, evaluator,
registry commit and model configuration before purchasing or running
any inference.
