# SilkWeb Creative — Milestone 3A Implementation Contract

## Objective

Integrate reusable advertising intelligence into the existing
three-image-ad Muse Spark planning workflow.

Improve creative strategy while preserving the current working MVP.

## Existing architecture

Reuse:
- apps/creative-studio/src/library.ts
- apps/creative-studio/src/recommend.ts
- apps/creative-studio/src/imageAdsPlan.ts
- apps/creative-studio/src/imageAdsLive.ts
- CREATIVE_LIBRARY_V1.md

Inspect actual interfaces before editing.

Do not replace the existing coding-agent registry, modify booking
benchmarks, or introduce a second generalized registry framework.

## Product contract

Users supply a product image or product name and a campaign objective.

Existing optional product details remain supported.

Users must never select:
- Advertising styles
- Copywriting frameworks
- Books
- Audience temperature
- Visual scenes

Generate exactly three ads:
1. Cold / discovery
2. Warm / consideration
3. Hot / action

Every ad must retain individual headline, body, CTA and visual prompt.

Do not change the existing UI or API response contract unnecessarily.

## Creative knowledge

Reuse the six approved styles and four approved frameworks.

Add a small, versioned advertising intelligence pack covering:

- Eugene Schwartz: customer awareness and message alignment
- David Ogilvy: research-led clarity, headlines and presentation
- Joseph Sugarman: copy flow, curiosity and benefits
- Robert Cialdini: ethical persuasion and evidence requirements

Represent each principle using:
- Stable ID
- Version
- Source attribution
- Short original-language summary
- Applicability conditions
- Actionable planning instruction
- Restrictions
- Verification status

No copied passages, invented quotations, fabricated page references,
or unsupported claims that source verification has occurred.

Clearly distinguish editorial summaries awaiting verification from
independently source-verified knowledge.

Use only appropriately reviewed principles in live planning.
Pending entries may be stored but must not be represented as verified.

## Retrieval and planning

Implement deterministic selection based on:
- Campaign objective
- Product description and supplied facts
- Available factual evidence
- Cold/warm/hot audience purpose

Select a compact subset of relevant knowledge.
Do not concatenate the entire library into every prompt.

Apply appropriate advertising style and copywriting framework
guidance separately for each of the three concepts.

Ensure three different strategic angles, not merely different wording.

Avoid selecting evidence-dependent formats without explicit support:
- Offers require a user-supplied genuine offer.
- Before/after requires supplied evidence of the claimed change.
- Testimonials and social proof require actual supporting evidence.
- Technical product benefits must remain grounded in supplied facts.

Do not treat words such as "better", "faster" or "improve"
as sufficient evidence of a real transformation.

Keep the Muse Spark planning prompt within existing size limits.
Do not silently truncate important safety constraints.

## Provenance

Record internally:
- Knowledge-pack version
- Selected style IDs
- Selected framework IDs
- Selected principle IDs
- Selection reasons
- Rejected evidence-dependent candidates when relevant

Do not expose internal creative terminology in the customer UI.

Do not claim the registry improves quality until comparison evidence
supports that conclusion.

## Compatibility and tests

Preserve:
- Current Meta API adapters
- Exactly three generated ads
- Existing image upload behavior
- Explicit local-draft fallback
- No automatic paid retries
- Existing claim-safety checks
- Existing passing tests
- Existing benchmark evidence and Git history

Add offline tests for:
- Deterministic recommendations
- All three audience strategies
- Book-knowledge selection and exclusions
- Evidence-gated styles
- Unsupported product claims
- Prompt size safety
- Provenance
- Existing response compatibility

Use mocked model responses only.

Run relevant tests and TypeScript build.

Do not execute live Meta inference.

## Boundaries

Do not implement typography or image compositing in this batch.
That is Milestone 3B.

Do not add SAM 3.1 or stock asset generation in this batch.
That is a later conditional milestone.

Do not install large new frameworks or dependencies unless essential.

Do not push, merge or create a release without approval.

## Deliverables

1. Minimal source changes implementing the integration.
2. Versioned creative knowledge pack.
3. Tests for selection, safety, provenance and compatibility.
4. Updated creative contract reflecting exactly three ads.
5. Clear report of changed files, test results and limitations.
6. No paid inference.
