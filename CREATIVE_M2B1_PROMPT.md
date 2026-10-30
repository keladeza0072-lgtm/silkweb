You are implementing SilkWeb Creative MVP Milestone 2B-1.

READ FIRST:
- CREATIVE_LIBRARY_V1.md
- CREATIVE_M2_CONTRACT.md
- apps/creative-studio/src/library.ts
- apps/creative-studio/src/concepts.ts
- apps/creative-studio/src/provider.ts
- apps/creative-studio/src/config.ts
- Existing automated tests

OBJECTIVE:
Integrate the approved six advertising styles and four
copywriting frameworks into the existing concept engine.

IMPLEMENT:

1. CREATIVE DEFINITIONS
Extend the existing creative library to include:
- Stable ID
- Name
- Purpose
- Composition instructions
- Copywriting rules
- Visual direction
- Appropriate usage conditions
- Factual and advertising restrictions

Use CREATIVE_LIBRARY_V1.md as the source of truth.

2. FRAMEWORK DEFINITIONS
Register AIDA, PAS, BAB, and FAB with:
- Stable ID
- Name
- Copy structure
- Application rules
- Factual restrictions

3. LIBRARY INITIALIZATION
Initialize the approved definitions on application startup.
Preserve the existing library configuration interface.
Unknown identifiers must still be rejected.

4. RECOMMENDATION LOGIC
Recommend suitable styles and frameworks from campaign context.
Respect explicit user preferences when compatible.
Never invent product facts or offers.
Do not recommend notification-offer when no offer exists.
Do not recommend unsupported transformation claims.

5. GENERATION CONTRACT
Make approved definitions and instructions available to
future live concept providers without changing the
existing two-concept output schema.

Do not use generic placeholder style definitions.
Do not return fake generated concepts.

6. TESTS
Preserve existing tests.
Add regression coverage for:
- Exactly six active styles
- Exactly four frameworks
- Valid library initialization
- Unknown ID rejection
- No-offer restrictions
- Recommendation behavior
- Compatibility with two-concept validation

BOUNDARIES:
- Modify only apps/creative-studio/
- No external AI calls
- No live provider implementation in this task
- No image generation
- No frontend redesign
- No Git commits
- No additional worktrees
- No benchmark modifications
- Minimal dependencies

VALIDATION:
Run TypeScript build and automated tests.
If the environment prevents validation, report that
honestly without claiming the tests passed.

Report changed files and remaining integration steps.
