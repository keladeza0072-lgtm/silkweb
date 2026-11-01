# SilkWeb Creative — Final MVP Muse Code Sprint

## Non-negotiable product contract
Customer supplies ONLY product image or product name and campaign objective. Return exactly THREE truly differentiated finished image ads, each with headline, body copy, CTA. No framework/style toggles appear in customer UI.

## Today: hard MVP feature freeze
Prioritize production reliability and *actual* quality improvements. Do not redesign the service, introduce databases, or build SAM dependencies. Maintain existing approved original-scene rights/hash checks. Do not use user-provided reference advertisements as stock photography.

## Work packages, in order
1. **Copy intelligence and measured quality.** Retain factual, evidence-gated copywriting. Build/strengthen a deterministic ad-copy diagnostic (generic-hook detection, repeated hook structures, lack of product relevance, unsupported factual claims, excessive length). Do not claim this is an objective conversion-performance metric. Muse Spark planner must propose multiple competing hook angles internally and choose the strongest three; JSON response shape remains unchanged. Add tests with five product categories and genuine product briefs. Reject generic headlines only where you can recover without discarding paid image calls. Prefer preflight planner-stage checks or one bounded text-only refinement; document additional API cost if implemented.
2. **Production visual quality.** Inspect output compositions to guarantee full visible headline, readable body where shown, proper text contrast and 1080x1350 image dimensions. Keep full body/CTA structured if not physically rendered in scene. Enhance contrast for varied photographic backgrounds; avoid overly large typography, edge clipping, fake text buttons, and text on top of the product. Feature-flag v2 and test before enablement.
3. **Gradient Hero safety.** Current SAM extraction produced obvious horizontal artifacts and residual hand; it is NOT release-ready. Disable SAM automatically for general customers unless explicitly enabled for isolated testing. Do NOT integrate defective cutouts into production. Preserve Gradient Hero as experimental until validated accurate cutouts become available; approved photographic scenes are the MVP default.
4. **Regression/security.** Build and run tests without live API credentials. Preserve no-retry behavior, API key privacy, image-byte limits, original-photo fallback, licensed-scene manifest integrity, and three-ad policy validation. No public deployment using paid credentials.
5. **Evaluation evidence.** Add a reproducible private harness to compare baseline vs new copy (same 5 products, same campaign objectives, factual flags). Record provider, prompts/version hashes, quality diagnostics and real model usage/cost if available; clearly distinguish model judgments from independent manual assessment. Save all results locally, never credentials or long data URLs to Git.

## Acceptance gates
- npm.cmd run build passes.
- All existing creative tests pass (including typography v2, planner, approved scenes, gradient).
- Exactly three differentiated ad specs and distinct audience contexts.
- Six/ten/even many synthetic passes do not substitute for a real finished-campaign test.
- No SAM artifacts allowed in production.
- Evidence of improvement based on exact text, visual inspection, and genuine recorded spend.
- Task ended with clear commit SHA, test counts, known failures, real model requests made, and actual credits consumed. Do not invent any.

## Budget controls
Available Meta credit at sprint planning: $105.58, reserve $25 for presentation; development spending ceiling $70, buffer $10.58. THIS IS A MAXIMUM, NOT A TARGET. Do not launch unbounded paid runs, authorize autonomous loops or retry generation automatically. Only paid coding-agent invocation under the user's configured billing/spending controls; stop if funding or pricing unclear. No secret values in logs.

## Model usage
Use the actual Meta coding agent where configured and beneficial. Prompt evaluations can use Meta Muse Spark text-only calls; image generation uses real Meta Muse Image only for a small controlled demonstration once gates pass. Record actual requests and costs, not estimated expenditure.
