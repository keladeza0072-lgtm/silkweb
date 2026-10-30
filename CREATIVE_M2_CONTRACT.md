# SilkWeb Creative MVP — Milestone 2

## Goal
Implement a reliable server-side advertising concept
generation foundation using Meta Muse Spark 1.3.

## User journey
Natural-language brief -> contextual clarification ->
campaign context -> two distinct concepts -> creative assets.

## Campaign context
- Original user description
- Product or service
- Campaign objective
- Advertising channel, when supplied
- Target audience, when supplied
- Creative direction, when supplied
- Brand, when supplied
- Offer, when supplied
- Known facts versus assumptions
- Selected style and photography mode

Brand, offer, and precise demographics must not be
mandatory for initial concept exploration.

Do not invent product claims, discounts, testimonials,
certifications, or factual benefits.

## Concept output
Exactly two distinct concepts per successful generation.

Each concept must contain:
- Stable concept ID
- Creative angle
- Headline
- Primary advertising copy
- Call to action
- Visual direction
- Photography prompt
- Copywriting framework identifier
- Advertising style identifier

Do not invent or silently replace unavailable framework
or advertising-style definitions.

## Backend
- Server-side generation orchestrator
- Explicit typed input and output schemas
- Campaign validation
- Provider adapter interface
- Deterministic test provider
- Strict output validation
- Clear provider failure responses
- Request timeouts
- Maximum response size
- No automatic retries on paid requests
- At most two concepts per campaign request
- No image generation in this coding milestone

## Security and cost
- Credentials remain server-side
- No secrets in browser code or logs
- Real inference disabled by default
- Explicit configuration required to enable a provider
- No model calls during automated tests
- No automatic paid generation on page load
- No uncontrolled loops or retries

## Testing
- Valid campaign request
- Optional brand and audience
- Explicit advertising channel
- Exactly two distinct concepts
- Invalid provider response
- Provider timeout or failure
- No real API calls during tests

## Boundaries
- Only modify apps/creative-studio/
- Preserve existing SilkWeb infrastructure
- Preserve current elicitation behavior
- Do not redesign the interface in this milestone
- Do not modify benchmark evidence
- Do not commit or create worktrees
- Do not invoke any external AI API
