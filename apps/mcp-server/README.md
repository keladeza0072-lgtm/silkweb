# apps/mcp-server

Local-only Silk Web MCP server (stdio). Exposes `ping` plus three
read-only librarian tools over the Git-backed certified registry.
No cloud hosting, vector database, UI, paid services, booking
modules, or embedded AI model. Muse Spark 1.3 acts as the Librarian
through these MCP tools; the server itself calls no AI APIs.

## Local build prerequisite

The librarian tools load the compiled registry (`packages/registry/dist`)
at runtime and validate evidence against the live checkout, so both
packages must be built from current source first. From the repository
root:

```sh
npm run build --prefix packages/registry
npm run build --prefix apps/mcp-server
```

If `packages/registry/dist` is missing or unreadable, the librarian
tools fail closed with `REGISTRY_BUILD_MISSING` instead of serving
anything. `ping` keeps working in that state.

## Tools

All tools are read-only. Stdout is reserved for JSON-RPC; the server
never writes logs there.

| Tool | Input | Output |
|---|---|---|
| `ping` | `{}` | `{ ok: true, service: "silkweb" }` |
| `search_verified_components` | optional `capabilities` (AND), `stack` (exact), `query` (case-insensitive substring), `limit` (default 10, max 25) | deterministic `(id, version)`-ordered summaries with exact id/version and capabilities, plus `totalTrusted` and rejected id/version/code entries |
| `inspect_verified_component` | exact `id`, `version` | contract: invariants, dependencies, runtime requirements, verification status, actual evidence metadata, executed test scope, known limitations |
| `get_verified_component_source` | exact `id`, `version`, optional bounded `maxBytesPerFile` / `maxTotalBytes` | repo-relative file paths with bounded content, including required local source dependencies (e.g. `manifest.ts` for `registry-loader`) |

## Trust rules (fail-closed)

- A component is served only when its manifest declares
  `verification.status === "verified"` **and** `validateComponent`
  confirms its current evidence against the live checkout. Evidence-valid
  manifests still declaring `"unverified"` are never served.
- Evidence is rechecked on every call; labels and stored hashes alone
  are never trusted. Missing, stale, forged, or invalid records yield an
  error code (`MISSING_EVIDENCE`, `STALE_EVIDENCE`,
  `SOURCE_HASH_MISMATCH`, `UNVERIFIED`, `NOT_FOUND`, …) and no source.
- Source paths come only from the registry's component attribution
  plus a servable-path guard: safe repo-relative paths, never
  `experiments/` or `harness`, never anything escaping the checkout.
- The repository root is discovered from the running server file, so
  results do not depend on the caller's working directory.
- The server never executes manifest-provided commands, regenerates
  certification evidence, or modifies manifests.

## Run

From this directory:

```sh
npm install
npm run check   # build (tsc) + smoke (init/list/ping) + tests (node --test tests/)
```

`SILKWEB_MANIFEST_DIR` (absolute path) overrides the manifest
directory for isolated negative testing; it can never point into
`experiments/harness`. Test scratch space lives under `tests/tmp/`
(gitignored) and is removed after the run.
