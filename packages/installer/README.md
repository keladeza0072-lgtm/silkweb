# Silk Web Phase 1 — Verified Source Installer

This is a new **read-only registry consumer**, not a modification to the certified
registry. The only writes are inside the explicitly selected target application.

## What it does

`silkweb install booking-reservation-kernel@0.2.0` performs a deterministic,
fail-closed **source-level installation**:

1. Resolve the exact component version and its full transitive manifest closure.
2. Require every component to declare `verification.status=verified` and pass
   the registry's existing `validateComponent` fingerprint, build-artifact and
   evidence checks. The manifest's status alone is never sufficient.
3. Resolve all local TypeScript source files, preserving relative import paths.
4. Check all pinned external runtime dependencies in the target `package.json`.
   The installer never silently changes dependencies, lockfiles or executes npm.
5. Preview destinations, then refuse collisions or symlinks. Identical existing
   files are reused without replacement.
6. Copy byte-exact sources to `src/silkweb/` using exclusive file creation.
   Roll back newly created files/directories if a write fails.
7. Write a local JSON audit record:
   `.silkweb/installations/booking-reservation-kernel@0.2.0.json`.

Source files are copied byte-for-byte, not rewritten. The registry is never
mutated. The report records the certified artifact fingerprint and source hash,
the exact evidence reference, full component closure, runtime dependencies,
and SHA-256 for each installed file.

**Important assurance boundary:** The report asserts only that the source came
from the certified registry and was installed with matching bytes. It does
**not** assert that the target application compiles, its dependencies are
already downloaded, tests pass, or its API behaves correctly. Phase 3 adds
integration verification.

## Setup (PowerShell, Node.js 24+)

Run inside a fresh development checkout, **not** the preserved benchmark
worktrees:

```powershell
cd "$HOME\Projects\silkweb-phase1\packages\registry"
npm ci
npm run build
cd ..\installer
npm run check
npm link
```

The built registry is a prerequisite because validation checks the executed
build artifacts bound to the existing certification evidence. An unbuilt or
stale registry fails closed; it does not self-certify.

From an existing TypeScript/NodeNext target project that already declares
`zod: "4.6.7"` (the reservation kernel's exact pinned dependency):

```powershell
cd "$HOME\Projects\my-booking-app"
silkweb install booking-reservation-kernel@0.2.0 --dry-run
silkweb install booking-reservation-kernel@0.2.0
silkweb install booking-reservation-kernel@0.2.0 --json
```

For a specific destination:

```powershell
silkweb install booking-reservation-kernel@0.2.0 --project "$HOME\Projects\my-booking-app" --into src/silkweb
```

Without `npm link`, invoke the CLI directly:

```powershell
node "$HOME\Projects\silkweb-phase1\packages\installer\bin\silkweb.mjs" install booking-reservation-kernel@0.2.0 --project "$HOME\Projects\my-booking-app" --dry-run
```

## Current constraints

- Exact `id@major.minor.patch` only. No ranges, implicit latest or unverified.
- Registry sources currently must be under `packages/registry/src/` and
  be TypeScript files; copied under the same relative layout.
- The target must already have `package.json` with `"type": "module"`,
  `tsconfig.json`, and exact declared runtime dependencies. This avoids
  silently leaving package-lock.json or npm install state inconsistent.
- The installer does not run npm scripts or tests in the target.
- It does not resolve dependency compatibility beyond exact version agreement,
  ESM package type and presence of a TypeScript configuration. Full build
  compatibility is not claimed.
- Symlink paths, path traversal, protected registry/experiment destinations,
  modified files and conflicting audit records are rejected.
- Local concurrent changes by a malicious process cannot be made fully atomic
  using portable filesystem APIs; do not run against a concurrently mutated,
  adversarial project tree. A successful run checks every created file's bytes.

## No benchmark evidence changes

This package lives outside `packages/registry` and `registry-data`; it does
not change `mvp-freeze`, RES-002 branch/evidence, existing certification data or
held-out evaluator files. Tests use temporary external target projects.
