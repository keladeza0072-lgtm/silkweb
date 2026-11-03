# Silk Web Studio — three-screen contract approval (Day 5 MVP)

Local-only prototype with exactly three screens: **Requirements**,
**Contract**, **Verification**. Plain HTML/CSS/JavaScript frontend, no
framework. HTTP API on top of Node.js 24 + TypeScript + built-in
`node:http`. Binds to `127.0.0.1`, default port `3001`.

No React, database server, AI calls, cloud hosting, vector database, or
extra dependencies. All registry trust decisions come from the existing
compiled Librarian implementation (`apps/mcp-server/dist/librarian.js`,
itself backed by `packages/registry/dist/index.js`) — Studio defines no
second certification validator.

## Build prerequisites (registry, MCP Librarian, Studio)

Studio reuses the compiled trust artifacts, so build them first, from the
repository root, in this order:

```powershell
cd packages/registry
npm install
npm run build
cd ../../apps/mcp-server
npm install
npm run build
```

## Install, build, test, run

Windows PowerShell, run from the repository root:

```powershell
cd apps/studio
npm install
npm run build
npm test
npm start
```

Then open `http://127.0.0.1:3001` in a browser.

- `npm test` builds the TypeScript and runs the Studio suite
  (`tests/studio.test.mjs`) against disposable fixtures in `tests/tmp/`
  — never real certification evidence. The socket-free service layer
  (`src/service.ts`) is tested directly; no HTTP listening socket is
  required.
- Approvals persist in `apps/studio/data/approvals.json` (gitignored).
  Delete that file to clear recorded approvals. `STUDIO_DATA_FILE` (repo-
  relative or absolute under `apps/studio/`) overrides the path, e.g.
  `$env:STUDIO_DATA_FILE = "apps/studio/tests/tmp/manual.json"`.
- `$env:PORT = "3002"; npm start` overrides the port.
- The booking demo link points at `http://127.0.0.1:3000`. Studio probes
  `/api/health` before display and never claims the demo is running
  unless the probe just succeeded. Start it separately:
  `cd ../booking-app; npm start`.

## The three screens

1. **Requirements** — enter a requirement (sample provided: “Prevent
   double-booking for a barbershop using fixed 30-minute appointment
   slots.”), pick capability tags (default `slot-guard`), and search.
   Matching is deterministic: exact capability tags with AND semantics
   plus a substring text filter. It is not semantic AI search. Only
   components that declare `verified` **and** pass current validation
   are ever listed, each with ID, version, capabilities, and
   certification eligibility. Select one to continue.
2. **Contract** — the exact certified contract: identity, version,
   dependencies, runtime requirements, invariants, source hash, and
   known limitations (including the fixed-30-minute constraint and the
   sequential same-process concurrency testing limit). “Approve
   Contract” requires checking the limitations acknowledgment, then
   records requirement text, capability, component ID/version, source
   hash, evidence fingerprint, and approval time — after revalidating
   the component. An approval whose fingerprint or certification status
   no longer matches the registry is shown as stale, never current.
   Approval records your review; it does not retroactively gate the
   existing booking app.
3. **Verification** — real evidence for the component (outcome,
   executedAt, test command, test files, runtime versions, source hash,
   artifact fingerprint, declared limitations), the live trust-gate
   verdict (not a saved label), and whether your approval still matches
   current evidence. Stale, missing, or invalid evidence renders a
   clear failure, never green.

## Trust & security notes

- Serve-only rule inherited from the Librarian: `verified` status AND
  passing current validation, fail-closed.
- Studio never modifies registry manifests, sources, hashes, or
  evidence; no arbitrary filesystem reads; no manifest command
  execution; no source exposure from untrusted components.
- All writes are confined to `apps/studio/data/` (or `tests/tmp/`
  under `STUDIO_DATA_FILE`); anything outside `apps/studio/` is
  refused, as is anything under `experiments/harness`.
- Never reads `experiments/harness` or held-out tasks.
- Local prototype only: no authentication. Anyone who can reach the
  loopback server can read contracts and record approvals.

## JSON API (loopback only)

| Method | Path | Result |
|---|---|---|
| `GET` | `/api/health` | `200 {"ok":true}` |
| `GET` | `/api/capabilities` | `200 {"capabilities":[...],"totalTrusted"}` |
| `GET` | `/api/search?capability=&query=&stack=&limit=` | trusted matches + deterministic note |
| `GET` | `/api/contract?id=&version=` | full contract + live validation verdict |
| `GET` | `/api/approvals` | approvals with live stale/current flags |
| `POST` | `/api/approvals` | `201` approval; `400` missing fields/acknowledgment; `409` not currently certified |
| `GET` | `/api/verification?id=&version=` | evidence + gate verdict + matching approvals |
| `GET` | `/api/booking-status` | `{running, url, status?}` from a live probe |
