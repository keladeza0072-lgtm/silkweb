# Silk Web — Hackathon agent rules

Approved MVP: one barbershop booking flagship, Muse Code with Muse Spark 1.3,
local stdio MCP, Git-backed curated registry, contract approval, three-screen
Studio (Requirements / Contract / Verification), and independent held-out checks.

## Day 1
- Deliver only a local TypeScript MCP server exposing read-only `ping`.
- Expected result: `{"ok":true,"service":"silkweb"}`.
- Do not claim Muse Code integration until its /mcp inventory and invocation were observed.
- Never send secrets, `.env` files, or private project data to the model.
- No paid model calls until account mode, credits, limits, and billing source are verified.

## Benchmark integrity
- A: vague natural request, no Silk Web (narrative only).
- B: same clarified spec as C, no Silk Web tools (PRIMARY CONTROL).
- C: same clarified spec as B, Silk Web MCP/registry enabled (TREATMENT).
- Same model/version, reasoning effort, step cap, dependency lock,
  initial clean repo, machine, and permissions in B and C.
- Keep `experiments/harness/` inaccessible to both coding agents. Agents may
  not read, modify, or receive held-out tests. Don't bake the harness into the
  generated app repo in an experiment.
- Count all trials, retries, repairs, librarian usage, and elapsed time.
- No "verified" registry manifest without exact source hash and passing tests.
