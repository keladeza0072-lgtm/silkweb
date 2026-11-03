TASK: Integrate the approved SilkWeb V1 frontend.

SOURCE OF TRUTH:
design/silkweb-approved-v1.html

EXISTING APPLICATION:
apps/creative-studio/

IMPORTANT:
The approved HTML is the design specification.
Do NOT invent a new design.
Do NOT redesign the homepage.
Do NOT replace the orange brand identity.

BRAND:
Name: SilkWeb
Logo: Orange Bethlehem-style star + SilkWeb wordmark
Primary: #FF5A0A
Background: #FCFBF8
Hero: "One prompt. An entire campaign."

IMPLEMENT:

1. Adapt the approved homepage into the existing app.
2. Preserve layout, typography, colors, spacing and visual hierarchy.
3. Connect the centered prompt to existing campaign elicitation.
4. Connect campaign review to existing validation.
5. Connect concept generation to /api/concepts/generate.
6. Display exactly two real concepts returned by the API.
7. Connect evaluation to /api/evaluate.
8. Connect website preview to /api/landing/preview.
9. Preserve the existing image-generation endpoint.
10. Preserve honest unavailable states.
11. Keep the workspace responsive on mobile.
12. Remove mock/demo responses from production workflows.

SECURITY:
- Never expose MODEL_API_KEY in browser code.
- Never enable paid inference automatically.
- No live API calls during development.
- Never fabricate generated concepts or images.
- No automatic paid retries.

BOUNDARIES:
- Modify only apps/creative-studio/.
- Preserve all backend contracts.
- Preserve existing tests.
- Do not touch MCP, registry or benchmarks.
- Do not commit.
- Do not create worktrees.

ACCEPTANCE:
- Homepage visually follows approved HTML.
- User can enter one short skincare prompt.
- Relevant clarification appears only when necessary.
- Campaign can be reviewed.
- Concept generation uses the real existing API.
- Results flow into evaluation and website preview.
- Image generation remains honestly unavailable until connected.
- Existing functionality survives integration.

Run build and all tests.
Report what works, what is blocked and how to launch locally.