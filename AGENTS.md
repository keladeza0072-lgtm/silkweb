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

## Active Creative MVP — October 2026

The original barbershop MVP and benchmark rules above
remain historical and must be preserved.

Current active application:
apps/creative-studio/

Current branch:
creative-mvp

Required design and implementation contracts:
- SILKWEB_IMAGE_ADS_BUILD.md
- SILKWEB_IMAGE_ADS_MILESTONE_2.md

### Active product
SilkWeb Image Ads Generator.

User provides a product image or name and selects
a campaign objective.

Optional product details:
- Differentiator
- Price and currency
- Genuine special offer

Output exactly three image advertisements.

Cold, warm, and hot audience strategies remain internal.
The quantity indicator displays three and is fixed.

### Model responsibilities
Muse Spark 1.3: Creative strategy and advertising copy.
Muse Image 1.0: Actual advertisement imagery.
SilkWeb: Orchestration, validation, knowledge reuse,
policy checks, export and delivery.

SAM integration is deferred.

### Engineering boundaries
Preserve the approved design and existing application.
Do not redesign the customer experience.
Do not alter previous benchmarks or held-out tests.
Do not expose credentials or private secrets.
Do not initiate paid application inference.
Use mocked provider responses for automated tests.
Do not fabricate successful AI-generation results.
Do not commit without explicit authorization.

### Verification
Build and run the relevant test suites.
Report all modified files and test results.
Clearly distinguish completed functionality from
untested or unavailable functionality.
