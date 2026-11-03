You are implementing SilkWeb Creative MVP Milestone 1.5.

Read:
- CREATIVE_MVP.md
- CREATIVE_UX.md
- apps/creative-studio/README.md
- Existing creative-studio source and tests

GOAL:
Transform the working Creative Studio shell into a
polished, guided commercial creative application.

Preserve the existing implementation wherever practical.

IMPLEMENT:

1. WELCOME EXPERIENCE
- One prominent free-text campaign description.
- Example campaign prompts.
- Premium editorial styling.
- Clear primary action to begin.

2. DETERMINISTIC ELICITATION
- Extract explicit information from the user's description.
- Ask one relevant question at a time.
- Never repeat answered questions.
- Maximum three clarification questions by default.
- Provide suggested answers, custom responses,
  and skip where appropriate.
- Avoid pretending to understand information not supplied.
- Do not infer unsupported product claims.
- Do not invoke any external AI service.

3. CAMPAIGN REVIEW
- Show the structured brief.
- Distinguish supplied facts from assumptions.
- Allow editing before proceeding.
- Preserve existing validation where practical.
- Do not block progress on nonessential details.

4. GUIDED NAVIGATION
- Welcome -> Clarify -> Review -> Create.
- Back and next navigation.
- Preserve state across navigation.
- Keep advanced creative settings optional.
- Do not show all output panels simultaneously.

5. CREATE STAGE
- Show two concept slots.
- Show two image slots.
- Show readiness evaluation.
- Show advertising policy review.
- Show landing-page generation.
- Clearly mark inference-dependent actions disabled.
- Never fabricate AI output.

6. VISUAL DESIGN
- Sky Blue #0593C6
- White #FCFFFF
- Hot Pink #D83995
- Premium glassmorphism and subtle gradients.
- Strong typography and whitespace.
- Mobile responsive.
- Accessible keyboard controls.

ENGINEERING:
- Work only inside apps/creative-studio/.
- Preserve the original SilkWeb systems.
- Use minimal dependencies.
- Keep backend validation and security controls.
- Update tests for the redesigned workflow.
- Keep application runnable on Node.js 24.
- No paid API calls.
- No Git commits.
- No additional worktrees.
- No unnecessary installation.

ACCEPTANCE:
- A user begins with one natural-language description.
- The app asks only missing contextual questions.
- Users can review and edit their brief.
- Users can reach the Create stage.
- All inference remains disconnected.
- Build and tests pass.

Report exactly what changed and any limitations.
