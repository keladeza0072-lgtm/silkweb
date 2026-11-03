# SilkWeb Creative — Elicitation Correction

## Objective
Fix the existing Milestone 1.5 elicitation logic.
Do not redesign the entire application in this task.

## Observed defects
1. Product extraction misses ordinary phrasing such as "I sell".
2. Objective extraction misses "want to create ads that attract customers".
3. Static suggestions are unrelated to the user's campaign.
4. Fixed question ordering creates unnecessary clarification.
5. Maximum question limits are not consistently enforced.
6. Brand and offer are requested before genuinely needed.

## Required behavior
- Recognize explicitly supplied campaign information.
- Preserve the user's exact product facts.
- Do not invent product benefits, claims, prices, or offers.
- Separate known facts, assumptions, and blocking unknowns.
- Ask questions only when needed for the next action.
- Ask no more than three clarification questions per campaign.
- Never repeat answered or skipped questions.
- Never suggest unrelated products or brand names.
- Treat brand name, offer, and precise demographics as optional
  until the requested generation action requires them.
- Support proceeding without unnecessary clarification.
- Preserve user corrections and previous answers.

## Acceptance scenario A
Input:
"I sell premium handmade skincare products and want to
create Instagram ads that attract new customers.
I want the campaign to feel luxurious, natural, and trustworthy."

Expected:
- Product: premium handmade skincare products.
- Channel: Instagram.
- Objective: attract new customers.
- Direction: luxurious, natural, trustworthy.
- Do not ask what product the user sells.
- Do not ask for the campaign objective again.
- Never suggest coffee, fitness apps, or ceramic mugs.
- An optional high-value clarification may ask whether
  the campaign promotes a collection or a specific product.

User response:
"The entire skincare collection."

Expected:
- Preserve collection-level campaign scope.
- Do not ask the same question again.
- Proceed when the context is sufficient.

## Acceptance scenario B
Input:
"Acme Coffee is launching cold-brew cans for commuters
aged 25-40 to drive launch-week trials."

Expected:
- Recognize brand, product, audience, and objective.
- No unnecessary follow-up questions.

## Acceptance scenario C
Input:
"Help me advertise my business."

Expected:
- Ask what business, product, or service is advertised.
- Ask only subsequent blocking questions.
- Maximum three clarification questions total.

## Engineering requirements
- Preserve existing API compatibility where practical.
- Keep all application changes within apps/creative-studio/.
- Update automated tests.
- Do not connect external AI services.
- Do not modify existing SilkWeb infrastructure.
- Do not invent successful test outcomes.
- Do not initiate paid inference without explicit approval.
