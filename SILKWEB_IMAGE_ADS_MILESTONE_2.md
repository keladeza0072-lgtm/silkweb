# SILKWEB — MILESTONE 2: REAL META IMAGE ADS

Read SILKWEB_IMAGE_ADS_BUILD.md first.

## GOAL

Upgrade the working Image Ads MVP into a real
Meta-powered advertising generation application.

Produce exactly three professional image ads
with individual advertising copy.

Preserve existing design and Git history.

## CUSTOMER EXPERIENCE

Required:
- Product image OR product name
- Campaign objective

Optional, collapsed by default:
- Product differentiator
- Product price and currency
- Special offer

Add a compact quantity indicator displaying 3.
Quantity is fixed at three for this MVP.
Do not introduce misleading interactive controls.

No audience selectors.
No advertising-framework selectors.
No model selectors.
No campaign questionnaires.

## MODEL RESPONSIBILITIES

MUSE SPARK 1.3:
- Interpret product information
- Apply internal advertising knowledge
- Select appropriate creative approaches
- Generate three differentiated strategies
- Generate headlines, body copy and CTAs
- Produce structured visual-generation prompts

MUSE IMAGE 1.0:
- Generate actual advertisement imagery
- Use uploaded product references where supported
- Produce visually distinct compositions
- Preserve product appearance as closely as possible
- Avoid inventing branding or product attributes

Use the official Meta Model API.

Do not assume Muse Spark generates image files.

## AUDIENCE STRATEGY

Produce one creative for each:

1. COLD — Discovery
2. WARM — Consideration
3. HOT — Action

Adapt strategies to the selected campaign objective.

The audiences are internal creative strategies.
Do not claim real audience targeting or guaranteed
campaign performance.

## IMAGE PRODUCTION

Use Muse Image as the primary visual engine.

Support product uploads:
- PNG
- JPEG
- WebP

For supplied product photography, prefer
reference-guided generation or editing.

For product names alone, avoid fabricating the
appearance of identifiable branded products.

Output:
- Three distinct advertisements
- 1080 x 1350 pixels
- PNG format
- Downloadable files
- Individual headline, body copy and CTA

Validate model output before delivery.

If text rendering is inaccurate, use deterministic
typographic finishing where appropriate.

Do not use the previous bitmap font for final ads.
Do not place SilkWeb branding inside customer ads.

## SILKWEB INTELLIGENCE

Reuse existing advertising formats and frameworks.

Keep these internal.

Where feasible, reuse the existing SilkWeb
registry and orchestration infrastructure.

Do not fabricate shared-registry integration.

Separate:
1. Input validation
2. Creative planning
3. Policy validation
4. Muse Image generation
5. Image finishing
6. Output verification

## SAFETY

Never invent:
- Discounts
- Prices
- Product specifications
- Testimonials
- Endorsements
- Deadlines
- Scarcity claims
- Before-and-after results

Add internal advertising-policy checks.
Do not guarantee Meta advertising approval.

Treat user-provided claims as unverified.
Avoid turning unverified claims into stronger claims.

## SAM

Do not integrate SAM yet.

Muse Image already supports reference-guided editing.

Consider SAM only after testing shows a measurable
product-isolation problem that Muse Image cannot
adequately solve.

## INFERENCE CONTROLS

Do not perform paid application inference
during implementation or automated tests.

Use mocked API responses for integration tests.

Live Muse Spark and Muse Image testing requires
separate explicit authorization.

No automatic paid retries.

Never show deterministic local drafts as
Meta-generated results.

Keep existing offline drafts clearly labeled
until live inference is enabled.

## IMPLEMENTATION REQUIREMENTS

- Preserve existing branding and layout
- Fix broken upload preview
- Add optional product details
- Add fixed-three quantity indicator
- Build Muse Spark planning adapter
- Build Muse Image generation/edit adapter
- Add structured-output validation
- Add internal policy checks
- Add image processing and PNG export
- Preserve previous tests
- Add appropriate integration tests
- Verify build and test suite
- Report actual changes and limitations

## DEFINITION OF DONE

A product and campaign objective produce
three genuinely Meta-generated advertisements,
each with its own copy and valid PNG download.

The entire customer journey works in a browser.

Do not claim completion until live functionality
has been explicitly tested and verified.
