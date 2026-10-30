# SilkWeb Creative Studio — Milestone 1 shell

Standalone, locally runnable campaign-brief workspace for the Creative MVP
([CREATIVE_MVP.md](../../CREATIVE_MVP.md)). Plain HTML/CSS/JavaScript
frontend, Node.js 24 + TypeScript backend on built-in `node:http`.
Binds to `127.0.0.1`, default port `3003`.

**Milestone 1 builds the shell only.** Model generation is NOT connected:
every generation control (concepts, images, evaluation, policy review,
landing page) is visibly disabled, the API reports
`"generationConnected": false`, and no endpoint invents campaign results
or scores.

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
  (`tests/creative-studio.test.mjs`, socket-free: config, validation,
  and static-allowlist checks directly against `dist/`).
- `$env:PORT = "3004"; npm start` overrides the port.
- No dependencies beyond dev-time `typescript` + `@types/node`.
  No external AI calls, no secrets, no persistence — validated briefs
  live in the page session only.

## What is inside

1. **Dashboard** — branded nav, editorial hero, live model-connection
   status from `/api/health`, workspace stats.
2. **Campaign brief form** — brand, product, audience, objective
   (required) plus offer and creative direction (optional). Client-side
   checks mirror the server rules; submit also calls
   `POST /api/briefs/validate`.
3. **Six advertising-style slots** — clearly labeled temporary slots
   (`style-slot-a`…`f`, `placeholder: true`) served from `/api/config`
   until the final style library lands.
4. **Photography mode selector** — product, lifestyle, website.
5. **Campaign workspace** — designated areas for 2 concepts, 2 images,
   creative evaluation, policy review, and landing-page preview. All
   show "not connected" placeholders with disabled buttons; nothing is
   presented as real model output.

## JSON API (loopback only)

| Method | Path | Result |
|---|---|---|
| `GET` | `/api/health` | `200 {"ok":true,"service":"creative-studio","version","generationConnected":false}` |
| `GET` | `/api/config` | styles, photography modes, brief fields, `generationConnected` |
| `POST` | `/api/briefs/validate` | `200 {ok:true,…}` or `422 {ok:false,issues}`; `400` on invalid JSON |

## Boundaries (do not cross in this milestone)

- No external AI API calls; no image generation; no invented
  concepts, scores, or landing pages.
- Nothing outside `apps/creative-studio/` is read or modified
  (sibling Studio/MCP/registry/booking apps, experiments, and
  benchmarks are untouched).
