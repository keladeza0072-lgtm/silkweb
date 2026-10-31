You are the lead product engineer and designer building SilkWeb Creative for a hackathon.

THIS MILESTONE MUST DELIVER A VISIBLE, WORKING PRODUCT EXPERIENCE.
Do not spend the session on speculative backend refactoring.

READ FIRST:
- CREATIVE_MVP.md
- CREATIVE_UX.md
- CREATIVE_LIBRARY_V1.md
- CREATIVE_M2_CONTRACT.md
- apps/creative-studio/src/
- apps/creative-studio/public/
- Existing tests

PRODUCT:
SilkWeb Creative turns a natural-language business description into:
two differentiated advertising concepts, actionable creative evaluations,
and a responsive campaign landing-page preview.

DESIGN:
Premium editorial creative studio.
Brand palette:
- Blue #0593C6
- White #FCFFFF
- Pink #D83995

Use strong typography, whitespace, polished cards, subtle glass effects,
careful spacing, and responsive layouts.
Make the experience feel like one coherent creative product.
Avoid generic admin dashboards, numbered wizard banners,
placeholder library entries, and unnecessary questions.
Do not rely on external images being available.

IMPLEMENT:

1. Replace the existing disconnected frontend experience with
   a coherent user-facing campaign workflow.

2. Keep natural-language briefing and existing intelligent elicitation.
   Ask questions only when information is genuinely needed.

3. Integrate POST /api/concepts/generate into the frontend.
   Show loading, success, error, and unconfigured states accurately.
   Never make automatic paid retries.

4. Display the actual six approved styles and four frameworks
   from the existing library. Remove temporary style slots from
   the visible product.

5. Render two full advertising concept cards:
   angle, headline, primary copy, CTA, style, framework,
   visual direction, and photography prompt.
   Include practical copy controls.

6. Implement a deterministic, transparent creative evaluation
   using seven weighted readiness criteria.
   Keep advertising-policy concerns separate.
   Never claim a model performed an evaluation when it did not.
   Never claim legal or Meta-policy approval.

7. Implement a responsive landing-page preview using the
   campaign context and chosen concept.
   Include hero, benefits or supporting information grounded in
   supplied facts, CTA, and mobile-responsive layout.
   Do not fabricate benefits, testimonials, discounts, or statistics.

8. Provide two clearly identified image-generation slots.
   Do not fabricate AI-generated image results.
   Prepare clean integration boundaries for a later image provider.
   Make the UI useful even before image generation is connected.

9. Preserve existing live provider safety gates.
   Do not enable inference by default.
   Do not call external APIs during implementation.

10. Add focused regression tests for the new workflow and
    run the complete existing test suite.

BOUNDARIES:
- Modify only apps/creative-studio/.
- Do not touch the core SilkWeb MCP, registry, or benchmarks.
- No live Meta requests.
- No paid image requests.
- No secrets.
- No new worktrees.
- Do not commit changes.

SUCCESS CRITERIA:
A user can open Creative Studio in a browser, describe a business,
review its campaign, request concepts when the provider is configured,
inspect two concept cards, see transparent evaluation, and preview
a responsive landing page.

REPORT:
- What visibly changed
- Files modified
- Commands to run the app
- Tests passed
- Any incomplete capability
- Honest end-to-end limitations

Prioritize a functioning demonstration over architectural polish.