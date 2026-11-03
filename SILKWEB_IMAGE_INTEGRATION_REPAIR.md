# SILKWEB — META IMAGE INTEGRATION REPAIR

Read AGENTS.md and both Image Ads contracts.

MISSION:
Repair the existing Milestone 2 implementation.
Do not redesign the interface or rewrite the application.

OFFICIAL API CONTRACTS:
https://dev.meta.ai/docs/image-generation
https://dev.meta.ai/docs/api-reference/images/edit-image

REQUIRED CORRECTIONS:

1. MUSE IMAGE ENDPOINT ROUTING
- Without uploaded image:
  POST /v1/images/generations
- With uploaded image:
  POST /v1/images/edits
- Use documented JSON `images` entries containing
  correctly formatted image data URLs.
- Remove undocumented reference_image/reference_format.
- Support PNG, JPEG and WebP references.
- Explicitly request supported PNG output.
- Preserve single-call, timeout and no-retry behavior.

2. IMAGE FINISHING
- Accept valid provider output dimensions.
- Fit images to 1080 x 1350 PNG without distortion.
- Handle aspect-ratio differences deliberately.
- Never stretch products or silently crop important details.
- Reject malformed or unsupported image data.

3. FINISHED ADVERTISEMENTS
- Muse Image supplies the actual creative photography.
- Add validated ad typography using a reliable renderer.
- Keep headlines, prices and CTAs accurate.
- Preserve negative space and visual hierarchy.
- No SilkWeb branding inside customer advertisements.
- Return exactly three finished PNG advertisements.

4. FRONTEND INTEGRATION
- Connect the UI to the live generation endpoint.
- Keep local drafts explicitly distinguishable.
- No automatic fallback that misrepresents drafts
  as Meta-generated results.
- Show useful errors when live inference is disabled.
- Preserve optional product details and fixed-three count.
- Keep the existing approved SilkWeb branding.

5. PARTIAL FAILURES
- Avoid silently discarding successfully generated ads.
- Return truthful partial results when appropriate.
- Never initiate automatic paid retries.

6. TESTS
- Mock all external provider requests.
- Test both generation and editing endpoints.
- Test PNG, JPEG and WebP references.
- Test output resizing and typography.
- Test three-ad results and partial failures.
- Test that live inference is disabled by default.
- Run the full TypeScript build and test suite.

RESTRICTIONS:
- No live Meta API calls.
- No paid application inference.
- No Git commits.
- No benchmark modifications.
- No SAM integration yet.
- No additional customer-facing configuration.
- Preserve existing functionality and uncommitted work.

Report all changes and remaining limitations.
