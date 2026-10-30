# SilkWeb Creative MVP — Guided Experience

## Product direction
Transform the existing Creative Studio shell into a
guided, commercial-quality AI creative application.

Avoid showing all stages on one dashboard.

## Primary user journey
1. Describe an idea in natural language.
2. Elicit missing campaign information.
3. Review two creative directions.
4. Produce original images and campaign copy.
5. Evaluate creative readiness and advertising policy.
6. Generate a landing page and export assets.

## Onboarding
- Begin with one prominent natural-language input.
- Do not require six separate fields initially.
- Provide example prompts to help users begin.
- Allow users to edit their campaign brief later.

## Adaptive elicitation
- Extract campaign information already provided.
- Ask only questions needed for the current decision.
- Never repeat answered questions.
- Prefer one contextual question at a time.
- Offer suggested answers and a custom response.
- Default to at most three clarification questions.
- Permit skipping nonessential questions.
- Show assumptions clearly and allow corrections.
- Never invent product facts, prices, or claims.
- Use deterministic rules initially.
- AI interpretation will be connected later.

## Experience design
- Guided stages, not a wall of controls.
- Progressive disclosure.
- Clear back and next navigation.
- Preserve campaign state across stages.
- Show creative styles as optional advanced controls.
- Recommend photography mode automatically when possible.
- Do not expose empty output dashboards prematurely.
- Make generation limitations transparent.

## Visual language
Sky Blue #0593C6
White #FCFFFF
Hot Pink #D83995

Premium editorial typography.
Immersive visual hierarchy.
Subtle glassmorphism and gradients.
Generous spacing.
Refined transitions.
Mobile-first responsive behavior.
Accessible text and controls.

## Engineering boundaries
- Preserve existing backend validation.
- Preserve current working tests.
- Keep AI generation disconnected in this milestone.
- Do not fabricate AI-generated results.
- Do not make external AI calls.
- Keep all implementation inside apps/creative-studio.
- Do not modify registry, MCP, benchmarks, or booking app.

## Completion criteria
A user can describe a campaign in natural language,
answer relevant follow-up questions, review the structured
brief, and navigate to the creative-production stage
without filling out the original six-field form.

The production stage must clearly show that model
generation is not yet connected.
