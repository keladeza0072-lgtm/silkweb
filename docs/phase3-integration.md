# Phase 3 — Integration verification

`silkweb verify-integration <exact-id@version>` is a **local, deterministic**
validation layer on top of the verified source installer. It does NOT run Muse,
make paid model calls, certify a new registry component, or alter any original
registry evidence.

## Trust and assurance

Verification is intentionally staged:

1. **Certified installation integrity**: call the same authoritative registry
   validator and dependency-closure checks used by `install`; require the
   original installation audit to match exactly and every installed source
   file to remain byte-identical to the certified registry.
2. **Target build**: invoke the **existing local TypeScript compiler** using
   `node node_modules/typescript/bin/tsc -p tsconfig.json`, without a shell.
   No npm scripts or package-manager operations are executed.
3. **Application reachability** (`--entry`): statically follow source ESM
   imports starting at a named `src/*.ts` entry and require that an installed
   certified source file be reached.
4. **Selected behavioral tests** (`--test`): run explicitly named
   `tests/*.test.mjs` (or test/*.test.js/cjs) using `node --test`; record the
   actual process exit, timeout status and bounded diagnostic output.

A result is labeled **`integration-verified` only when all four stages
pass**, including explicit `--entry` and at least one `--test`.
Without tests, results are classified `build-only` or
`build-and-entry-verified`, never integration-verified.
With tests but without an entry, results are `selected-tests-passed`
without claiming full integration linkage.

Every completed verification attempt creates a distinct, exclusive-write
report under `.silkweb/validations/<uuid>.json` in the target project.
Earlier records are not silently overwritten. A failure in selected tests
or build produces `verification-failed` and a nonzero CLI exit status.
An uncertified/tampered installation fails closed before compilation.
The report clearly notes that operator-selected test quality does not
guarantee production correctness.

## Windows PowerShell setup (Node 24+)

Run this from the **Phase 3 worktree**, keeping previous benchmark source
and worktrees untouched:

```powershell
cd "$HOME\Projects\silkweb-phase3\packages\registry"
npm.cmd ci
npm.cmd run check

cd "$HOME\Projects\silkweb-phase3\packages\installer"
npm.cmd run check
```

To verify the original disposable booking starter with installed certified
files and only its build, run:

```powershell
$repo = "$HOME\Projects\silkweb-phase3"
$demo = "$HOME\Projects\silkweb-installer-demo"
$cli = "$repo\packages\installer\bin\silkweb.mjs"

node $cli verify-integration booking-reservation-kernel@0.2.0 --project $demo --json
```

That result must be `build-only`, not integration-verified: the starter's
server still returns NOT_IMPLEMENTED and it has no user-chosen application
behavioral tests. The report establishes certified installation integrity
and TypeScript compilation **only**.

For an actual application, provide an entry and an explicit test path:

```powershell
node $cli verify-integration booking-reservation-kernel@0.2.0 --project "$HOME\Projects\my-booking-app" --entry src/server.ts --test tests/booking-integration.test.mjs --json
```

The named test must already exist and have meaningful assertions for the
application contract. Tests execute with project-local permissions; only
run trusted test files. No shell script from the registry or manifest is
ever executed.

## What Phase 3 does NOT establish

- That untested endpoints or production workflows behave correctly.
- Automated test synthesis, test coverage, security or correctness proofs.
- Changes to an existing certified component's original evidence.
- A new comparative benchmark improvement in inference cost or speed.

The prior RES-002 controlled performance comparison remains separate.
Phase 3 offers independently observable build, source integrity and selected
application test evidence for subsequent Muse-powered demonstrations.
