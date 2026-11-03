# SilkWeb Image Ads — Milestone 1

Offline slice of the Image Ads MVP
([SILKWEB_IMAGE_ADS_BUILD.md](../../SILKWEB_IMAGE_ADS_BUILD.md)):
one product input plus one campaign objective becomes exactly three
professional, downloadable image ads. Plain HTML/CSS/JavaScript
frontend, Node.js 24 + TypeScript backend on built-in `node:http`.
Binds to `127.0.0.1`, default port `3003`.

**Milestone 1 is fully offline.** Copy comes from deterministic,
claim-free templates and PNGs from the local raster renderer — the
API labels every result `"local-draft"` and no endpoint calls a
model. Muse creative review connects in a later milestone with
explicit approval.

## Install, build, test, run

Windows PowerShell, run from the repository root:

```powershell
cd apps/creative-studio
npm install
npm run build
npm test
npm start
```

Then open `http://127.0.0.1:3003` in a browser.

- `npm test` builds the TypeScript and runs the suite
  (`tests/creative-studio.test.mjs`, `tests/concepts.test.mjs`,
  `tests/library-2b.test.mjs`, `tests/live-provider.test.mjs`,
  `tests/image-ads.test.mjs`; socket-free).
- `$env:PORT = "3004"; npm start` overrides the port.
- No runtime dependencies beyond dev-time `typescript` +
  `@types/node`. No external AI calls, no secrets, no
  persistence — uploads live in the request only and are never
  stored.

## What is inside

1. **Create** — centered single-purpose screen: product image
   upload (PNG, JPEG, WebP, up to 1.5 MB) with thumbnail preview
   and remove/replace, product-name input, three objective cards
   (Drive Sales default, Build Awareness, Launch a Product), and
   a Generate Ads CTA. One of image/name is required.
2. **Generating** — loading animation with
   "Creating your three ads..." and rotating step messages. No
   invented percentage progress. Failures show an actionable
   error with a retry control.
3. **Results** — "Your ads are ready.": exactly three creative
   cards, each with its real 1080 x 1350 PNG preview at 4:5,
   individual headline, body copy, CTA, Download PNG, and Copy
   ad text. Three-column desktop, single-column mobile, plus a
   Start-new control.

The renderer composites uploaded **PNG** product photos
cover-fit into the creative. JPEG/WebP uploads are accepted and
shown as thumbnails, but this milestone renders a typographic
product plate instead of compositing them — the results screen
says so explicitly. Copy uses only the supplied product name:
no discounts, endorsements, testimonials, or results language.

## JSON API (loopback only)

| Method | Path | Result |
|---|---|---|
| `GET` | `/api/health` | `200 {"ok":true,"service":"creative-studio","version","generationConnected":false}` |
| `GET` | `/api/config` | styles, frameworks, modes, brief fields, prompts, elicitation defaults, policy checks, plus `imageAds` objectives and ad size |
| `POST` | `/api/image-ads/generate` | `200 {ok:true,objective,productLabel,ads:[{id,direction,angle,headline,body,cta,width,height,pngDataUrl,photoComposited}],photoComposited,engine,note}`; `422` on validation issues; `400` on invalid JSON; `413` on oversize bodies |
| `POST` | `/api/briefs/validate` | retained from the earlier workspace milestone |
| `POST` | `/api/elicit/analyze`, `/api/concepts/generate`, `/api/evaluate`, `/api/landing/preview`, `/api/images/generate` | retained backend contracts; not part of the customer-facing Image Ads flow |

## Boundaries (do not cross in this milestone)

- No external AI API calls; no paid inference; no invented
  discounts, endorsements, testimonials, or product claims.
- Never present draft renders as model-generated advertising.
- Nothing outside `apps/creative-studio/` is read or modified
  (sibling Studio/MCP/registry/booking apps, experiments, and
  benchmarks are untouched).
