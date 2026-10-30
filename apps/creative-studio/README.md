# SilkWeb Creative Studio — Milestone 1.5 guided workspace

Standalone, locally runnable campaign workspace for the Creative MVP
([CREATIVE_MVP.md](../../CREATIVE_MVP.md), [CREATIVE_UX.md](../../CREATIVE_UX.md)).
Plain HTML/CSS/JavaScript frontend, Node.js 24 + TypeScript backend on
built-in `node:http`. Binds to `127.0.0.1`, default port `3003`.

**Milestone 1.5 is guided but still offline.** Model generation is NOT
connected: every generation control (concepts, images, evaluation, policy
review, landing page) is visibly disabled, the API reports
`"generationConnected": false`, and no endpoint invents campaign results
or scores. Elicitation is deterministic local rules only — no AI service
is called.

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

1. **Welcome** — one prominent free-text campaign box, tappable example
   prompts (from `/api/config`), editorial hero, step progress, and live
   model-connection status from `/api/health`.
2. **Clarify** — deterministic elicitation over
   `POST /api/elicit/analyze`: extracts stated facts, asks one missing
   question at a time (max 3 by default), with suggested answers, custom
   input, and skip. Answered/skipped questions never repeat; vague input
   yields `missing`, never invented facts.
3. **Review** — structured brief with Supplied/Assumed/Missing badges,
   editable fields, explicit assumption list, and style/photography
   controls tucked inside optional advanced settings. Validates through
   the unchanged `POST /api/briefs/validate`; optional fields never block.
4. **Create** — 2 concept slots, 2 image slots, 7-item brief-completeness
   readiness list (not a model score), policy-reminder checklist, and
   landing-page preview. All generation buttons are disabled with
   "requires model inference" titles; nothing is presented as real output.
5. **Six advertising-style slots + photography modes** — clearly labeled
   temporary slots (`style-slot-a`…`f`, `placeholder: true`); photography
   mode is auto-recommended from setting cues, changeable in Review.

## JSON API (loopback only)

| Method | Path | Result |
|---|---|---|
| `GET` | `/api/health` | `200 {"ok":true,"service":"creative-studio","version","generationConnected":false}` |
| `GET` | `/api/config` | styles, photography modes, brief fields, example prompts, elicitation defaults, policy checks, `generationConnected` |
| `POST` | `/api/elicit/analyze` | `200 {ok:true,values,sources,questions,assumptions,readiness,…}` or `422` on bad input; `400` on invalid JSON. Deterministic — no AI calls |
| `POST` | `/api/briefs/validate` | `200 {ok:true,…}` or `422 {ok:false,issues}`; `400` on invalid JSON |

## Boundaries (do not cross in this milestone)

- No external AI API calls; no image generation; no invented
  concepts, scores, or landing pages.
- Nothing outside `apps/creative-studio/` is read or modified
  (sibling Studio/MCP/registry/booking apps, experiments, and
  benchmarks are untouched).
