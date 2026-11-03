You are implementing the SilkWeb Creative MVP elicitation correction.

Read:
- CREATIVE_ELICITATION_FIX.md
- CREATIVE_UX.md
- apps/creative-studio/src/elicit.ts
- apps/creative-studio/public/app.js
- apps/creative-studio/tests/creative-studio.test.mjs

OBJECTIVE:
Fix demonstrated elicitation defects without redesigning
the application or introducing external AI dependencies.

IMPLEMENTATION PRIORITIES:

1. Correct natural-language extraction.
   Recognize examples including:
   "I sell premium handmade skincare products"
   "I want Instagram ads that attract new customers"

2. Remove irrelevant static answer suggestions.
   Suggestions must be grounded in the current
   campaign context or omitted entirely.

3. Replace fixed missing-field questioning with
   next-action relevance decisions.

4. Enforce a maximum of three questions across
   the entire campaign interaction.

5. Never repeat answered or skipped questions.

6. Treat brand, offer, and demographics as optional
   unless genuinely required for the next action.

7. Allow the workflow to proceed immediately
   when sufficient context exists.

8. Add regression tests for scenarios A, B, and C
   in CREATIVE_ELICITATION_FIX.md.

9. Update the frontend only where necessary to
   support corrected question selection and limits.

IMPORTANT:
- Do not use an LLM for extraction in this milestone.
- Do not invent facts or product claims.
- Do not implement image generation.
- Do not redesign the website.
- Do not modify existing SilkWeb infrastructure.
- Do not change files outside apps/creative-studio/.
- Do not make Git commits or create worktrees.
- Do not invoke paid external APIs.

VALIDATION:
Run the build and automated tests.
Report changes and any remaining limitations.

Prioritize correctness and predictable behavior.
