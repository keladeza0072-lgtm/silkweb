# SILKWEB IMAGE ADS — FINAL DESIGN & IMPLEMENTATION CONTRACT

## Ownership
Product design and UX are specified by ChatGPT.
Muse Code is responsible for implementation, integration, and tests.
Do not independently redesign the product.

## Mission
Turn one product input and one campaign objective into
exactly three professional, downloadable image ads,
each with its own headline, body copy, and CTA.

## Approved visual identity
Brand: SilkWeb
Primary accent: #FF5A0A
Background: #FCFBF8
Primary text: #172235
Logo: Existing orange Bethlehem-style star and SilkWeb wordmark.
Visual direction: Minimal, premium, spacious, intentional.
Preserve the approved typography and brand character.

Reference:
design/silkweb-approved-v1.html

Existing frontend:
apps/creative-studio/public/

## Screen 1 — Create
Centered, single-purpose composition.

Header:
- Existing SilkWeb logo
- Minimal navigation

Hero:
"Your product. Three standout ads."

Supporting text:
"Upload your product, choose your goal, and let SilkWeb create."

Input:
- Product image upload OR product name
- Show uploaded image thumbnail
- Allow removing/replacing uploaded image
- Supported image formats: PNG, JPEG, WebP

Campaign objective:
- Drive Sales
- Build Awareness
- Launch a Product

Use three accessible, compact selectable controls.
Default to Drive Sales.

Primary CTA:
"Generate Ads"

No additional mandatory inputs.
No style, layout, framework, audience, model,
photography, or creative-direction selectors.

## Screen 2 — Generating
Show:
- Simple loading animation
- "Creating your three ads..."
- Subtle progress messaging

No invented percentage progress.
No intermediate user decisions.
Display actionable failures with retry controls.

## Screen 3 — Results
Heading:
"Your ads are ready."

Display exactly three distinct creative cards.

Each card includes:
- Actual generated 1080 x 1350 PNG
- Image preview at 4:5 ratio
- Individual headline
- Individual supporting body copy
- Individual CTA
- Download PNG action
- Copy ad text action

Desktop: Three-column layout when space permits.
Mobile: Single-column layout.
Images must maintain aspect ratio.
Do not crop or distort the finished creative.

Allow starting a new generation.

## Visual principles
- Generous whitespace
- Clear typography and content hierarchy
- Subtle borders
- Restrained shadows
- Consistent spacing
- Accessible contrast
- Responsive layouts
- Meaningful loading and empty states
- Minimal animation
- No dashboard aesthetic
- No unnecessary decorative elements

## Internal creative intelligence
Keep formats and frameworks completely internal.
Generate three genuinely differentiated creative directions.
Use only supported product facts.
Do not fabricate discounts, endorsements,
testimonials, product claims, or results.

## Technical behavior
The existing implementation produces two concepts.
Change the new MVP contract to exactly three.

Reuse Meta Muse provider integration where appropriate.
Use Muse for real creative reasoning and copy generation.

Implement actual image composition and PNG export.
Prefer reliable deterministic text/layout composition
with real product photography and licensed stock assets.

Preserve uploaded product identity.
Do not fabricate branded product appearances from names alone.

Successful generation requires three real PNG files.
Never label placeholders as generated advertisements.

Use existing SilkWeb registry and orchestration capabilities
where genuinely applicable; do not fabricate integration.

Preserve earlier tests, source history, and benchmark evidence.
Remove landing pages and clarification workflows
from the customer-facing experience.

## Implementation boundaries
- Work on creative-mvp
- Preserve uncommitted design files
- Never reset or discard existing changes
- Do not modify original benchmark results
- Do not initiate paid inference without approval
- No paid provider retries without approval
- No mock output presented as live generation
- Test locally before declaring completion

## Definition of done
1. User supplies product image or name.
2. User selects objective.
3. User clicks Generate Ads.
4. Muse creates three differentiated creative specifications.
5. Renderer produces three valid 1080 x 1350 PNG files.
6. Results display three previews and their individual copy.
7. All download and copy actions work.
8. Desktop and mobile flows are tested.
9. Existing tests remain valid or are deliberately updated.
10. Final live inference requires explicit approval.

## Final principle
The user provides the product and goal.
SilkWeb handles everything else.
