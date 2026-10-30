You are implementing SilkWeb Creative MVP Milestone 2A.

READ FIRST:
- CREATIVE_M2_CONTRACT.md
- CREATIVE_MVP.md
- CREATIVE_ELICITATION_FIX.md
- apps/creative-studio/src/
- apps/creative-studio/tests/

OBJECTIVE:
Implement the server-side foundation for generating
exactly two distinct advertising concepts.

SCOPE:

1. CAMPAIGN CONTEXT
Create typed campaign context structures.

Support:
- Original description
- Product or service
- Objective
- Advertising channel
- Optional audience
- Optional brand
- Optional offer
- Creative direction
- Facts versus assumptions

Do not break existing elicitation behavior.

2. CREATIVE LIBRARY CONTRACT
Define typed advertising-style and copywriting-framework
registries.

Do not invent the final six style definitions or
four research-based frameworks.

Reject unknown identifiers.
Allow explicit configuration of approved definitions.

3. CONCEPT GENERATION
Create a generation orchestrator that:
- Validates campaign context
- Requests exactly two distinct concepts
- Validates provider output
- Rejects malformed or duplicate concepts
- Returns clear errors
- Does not automatically retry

Each concept includes:
- ID
- Creative angle
- Headline
- Primary copy
- CTA
- Visual direction
- Photography prompt
- Style ID
- Framework ID

4. PROVIDER BOUNDARY
Implement a typed provider interface.

Use an injected deterministic test provider.

Real Meta Muse inference must remain disabled
until provider configuration is verified.

Never use fake model output as real generation.

5. API
Add a concept-generation endpoint with strict
input validation and safe error handling.

If no real provider is configured, return an
explicit unavailable response.

Do not expose test-provider output as live AI output.

6. TESTING
Add automated tests covering:
- Valid input
- Optional brand/audience
- Advertising channel
- Two distinct concepts
- Unknown framework/style rejection
- Invalid provider output
- Provider errors
- No real inference during tests

BOUNDARIES:
- Modify only apps/creative-studio/
- No external model calls
- No image generation
- No frontend redesign
- No Git commits
- No additional worktrees
- No benchmark modifications
- Minimal dependencies

VALIDATION:
Run TypeScript build and automated tests.

Report files changed, tests passed, and
remaining integration requirements.
