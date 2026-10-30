# Silk Web Studio — INV-INSTALL-002 verified delivery evidence

This branch extends the existing **three-screen read-only Studio dashboard**;
it does not replace the Registry or Agent Activity screens.

The Performance screen now places the **INV-INSTALL-002** delivery-method
comparison above the older RES-002 benchmark. These are different designs:
both INV-INSTALL-002 conditions use the same Silk Web MCP Librarian;
only I additionally exposes the operator-approved deterministic installer.
The existing RES-002 section remains separately labeled.

The new panel reads ONLY these local paths under
`$HOME/Projects/inv-install-002-20261030`:

- `operator/INV-INSTALL-002-final-evidence.json` (preserved snapshot);
- its nine explicitly named original preflight, run, evaluator, MCP audit
  and Muse log files;
- `I/src/silkweb/inventory.ts` and
  `I/.silkweb/installations/inventory-reservation@0.1.0.json`.

It verifies all nine preserved raw-byte hashes, frozen task/evaluator
identities, matched R/I configuration, 20/20 original held-out evaluations,
logged source retrieval vs installer invocation, installed source SHA-256,
and the exact source audit. Any missing or changed evidence results in
**Unavailable**; no simulated scores are displayed.

Only sanitized metrics (time, quality, token counts, user-recorded credit
balance changes), tool names and success statuses go to the browser. No
private prompts, complete MCP payloads, source bodies, auth material, raw Muse
events or absolute operator paths are ever returned. The UI states that
one paired comparison does not establish generalized improvement and
observed credit balance changes are not provider billing records.

To run locally after building the registry and MCP in this branch:

```powershell
cd "$HOME\Projects\silkweb-studio-delivery\apps\studio"
npm.cmd ci
npm.cmd test
npm.cmd start
```

Then open `http://127.0.0.1:3001/` and choose **Performance**.
No paid model calls are made. If the operator evidence is not on this
machine, the new comparison must show **Unavailable**.

---

# Silk Web Studio v2 — Evidence Dashboard

**Default landing page:** `http://127.0.0.1:3001/`

Silk Web Studio now opens a responsive, read-only three-screen dashboard:

1. **Registry** — live certified component count, conservative task-intent search,
   explainable match signals, capability and runtime metadata; all populated
   through the same authoritative MCP Librarian certification trust gate.
2. **Agent Activity** — sanitized local Muse Spark trial status and MCP audit
   metadata, without exposing prompts, credentials, source text or raw Muse logs.
3. **Performance** — only the actual RES-002 paired records when present,
   with exact coding times, weighted scores and final usage fields. Explicit
   caveats and missing-evidence states prevent invented improvements.

The **original Requirements / Contract / Verification workflow** is preserved
and available at `http://127.0.0.1:3001/legacy` (also `/index.html`).
Contract approvals still operate as documented below.

## Start the new dashboard (Windows PowerShell)

Build the existing certification dependency chain before Studio:

```powershell
$repo = "$HOME\Projects\silkweb-studio-v2"

cd "$repo\packages\registry"
npm.cmd ci
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw "Registry build failed" }

cd "$repo\apps\mcp-server"
npm.cmd ci
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw "MCP build failed" }

cd "$repo\apps\studio"
npm.cmd ci
npm.cmd test
if ($LASTEXITCODE -ne 0) { throw "Studio tests failed" }

npm.cmd start
```

Open `http://127.0.0.1:3001/`. The server binds only to
`127.0.0.1`, and no paid Muse/Meta/Baseten/Modal model calls are made.

## Evidence rules

The dashboard reads **only predefined local paths** under
`$HOME/Projects` for the earlier RES-002 and MUSE-INSTALL-001 operator
artifacts and the installation demo's Phase 3 validation reports. It does
not accept arbitrary filesystem paths from a browser, run any benchmark,
rewrite old trial results, reveal credentials, or execute model code.

If those prior artifacts are not available on the current machine, the
appropriate screen shows **Unavailable** rather than a sample score,
invented activity, or a false zero.

`GET /api/dashboard` is read-only and sanitized; `GET /api/search`
still performs real live certified-only discovery. The existing contract
review and approval API is unchanged.

**Assurance levels:** Certification confirms trusted registry source;
`build-only` confirms target compilation; only Phase 3 validations that
also pass named application-entry reachability and selected behavioral
tests claim `integration-verified`. A single RES-002 pair does not prove
general speed/quality improvement and is never represented as statistically
conclusive.

---

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
