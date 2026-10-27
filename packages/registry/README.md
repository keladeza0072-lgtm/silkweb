# packages/registry

Day-2 slice of Silk Web's Git-backed verified component registry: a barbershop
booking kernel plus a deterministic manifest loader. No vector database,
hosting, payments, or external AI calls.

## Modules

| Module | Source | Description |
|---|---|---|
| booking-schema@0.1.0 | `src/schema.ts` | SQLite tables for staff, services, appointments; database-enforced uniqueness for active bookings of one staff member at one start time (partial unique index); database-enforced canonical timestamps and exactly-30-minute services (CHECK constraints). |
| booking-validation@0.1.0 | `src/validation.ts` | Zod-validated booking input plus strict canonical-timestamp and 30-minute slot constraints. |
| booking-slot-guard@0.1.0 | `src/slotGuard.ts` | Transactional (`BEGIN IMMEDIATE`) booking creation; conflicting reservations fail with `SlotConflictError`; predictable typed errors; cancellation frees the slot for rebooking. |
| registry-loader@0.1.0 | `src/loader.ts`, `src/manifest.ts` | Deterministic loader for JSON manifests with exact version/stack/capabilities/dependency filtering. |

Manifests live in `registry-data/manifests/`. Every manifest's
`verification.status` is `"unverified"` until passing executable tests are
tied to the exact source hash, lockfile/dependency versions and runtime.
No timestamps, test results, or source hashes are fabricated.

## Booking invariants (prototype)

- Canonical timestamps: every `appointments.start_time` must be the strict
  canonical UTC form `YYYY-MM-DDTHH:mm:00.000Z` for a real calendar date on
  a 30-minute boundary (minutes `00` or `30`). Alternate spellings of the
  same instant — numeric timezone offsets (`+00:00`, `+02:00`, …), missing
  or lowercase timezone markers, omitted/short/long fractional seconds,
  and non-ISO date strings — are rejected both by input validation
  (`src/validation.ts`) and by a database CHECK constraint
  (`src/schema.ts`), so duplicate instants cannot evade the
  staff/slot uniqueness invariant, including via direct SQL writes.
- Fixed 30-minute slots: `services.duration_minutes` must be exactly `30`,
  enforced by a database CHECK constraint and re-checked by booking
  creation for databases built before the constraint existed.
  Variable-duration services are out of scope for the MVP: overlapping
  bookings with different start times are not modelled, and every
  appointment is assumed to occupy exactly one 30-minute slot.
- Prototype migration limitation: the schema is created with
  `CREATE TABLE IF NOT EXISTS`, which never retrofits new CHECK
  constraints onto tables built by an older schema revision. There is no
  ALTER migration in this slice: after pulling a schema change, recreate
  any existing database from scratch (fresh file or `:memory:`). Bookings
  made against legacy variable-duration services are refused with
  `BOOKING_REFERENCE_ERROR` rather than silently overlapping.

## Runtime notes

- Tested runtime: Node.js v24.15.0 (see `process.versions.sqlite` for the
  bundled SQLite version on your machine).
- `node:sqlite` status: built-in but still flagged release-candidate /
  experimental upstream — its API surface may change in a future Node major.
  This package pins usage to the stable subset used here (`DatabaseSync`,
  `prepare`/`get`/`all`/`run`, `exec` for `BEGIN IMMEDIATE`/`COMMIT`/
  `ROLLBACK`) and its tests run against the real module, not a mock.
- Dependencies are pinned exactly: `zod@4.6.7`, `typescript@5.9.3`,
  `@types/node@22.20.5`.

## Run

From this directory:

```sh
npm install
npm run check   # build (tsc) + tests (node --test tests/)
```

## Verification

The registry ships a minimal, reproducible verification engine
(`src/fingerprint.ts`, `src/evidence.ts`, `src/runner.ts`, `src/validate.ts`,
re-exported from `src/index.ts`). All four manifests stay `unverified`
until a human runs the steps below and records real evidence.

- Fingerprint: deterministic SHA-256 over the component's manifest
  identity/functional metadata, the source bytes of its transitive
  dependency closure, the covering test files, the package lockfile, and
  the declared environment (`package.json`). File paths are repo-relative
  and sorted; entries are null-framed; metadata is canonical JSON.
  Mutable verification results are excluded (hashing them would be
  circular), as are actual runtime versions (recorded in evidence instead,
  so the same tree hashes identically on any machine).
- Evidence: a JSON record (`registry-data/evidence/<id>-<version>.json`,
  schema version 1) with component id/version, artifact fingerprint plus
  per-section hashes, exact test command, exit code, outcome, Node/SQLite
  versions, timestamp, scope, and limitations. Written only by the runner
  after it really executes a command; failures are preserved as failures.
- Runner: executes ONLY fixed argv arrays from the explicit allowlist
  `TEST_COMMAND_ALLOWLIST` with no shell. A manifest's `testCommand`
  string is never executed. Only exit code 0 is recorded as a pass.
  `NODE_TEST_*` markers are scrubbed so a nested `node --test` child
  cannot report success for failing tests.
- Validation: recomputes fingerprints from the current checkout, resolves
  the dependency closure, checks declared dependencies against the
  lockfile, and requires schema-valid evidence with a passing outcome for
  an allowlisted command. Anything missing, mismatched, or stale fails
  closed. `selectVerifiedManifests` is the verified-only entry point: a
  manifest that merely says `"verified"` without valid evidence is
  rejected with an explicit reason, never silently accepted.

How a human reproduces verification (no secrets, no network, no paid
calls):

```sh
cd packages/registry
npm install
npm run build
node --test tests/schema.test.mjs tests/validation.test.mjs tests/slotGuard.test.mjs tests/loader.test.mjs
```

A passing run above is the allowlisted `registry:all-tests` command. Only
after observing it may a human (or a script they approve) call
`runVerification` with that allowlist key to write the evidence record,
then confirm `validateComponent`/`selectVerifiedManifests` accepts the
component. Evidence produced by the test suite itself lives under the
gitignored `tests/tmp/` and never touches `registry-data/evidence/`.

Known limitations: collision checks are sequential same-process
connections to a temp file database (no genuine race coverage);
`node:sqlite` is built-in but still flagged experimental upstream, so the
stable `DatabaseSync` subset used here is pinned; evidence binds the
observed machine's runtime and must be refreshed after any source, test,
lockfile, dependency, or metadata change.

Collision tests use two independent `DatabaseSync` connections to the same
temporary file-backed database. Execution is sequential same-process, so no
genuine simultaneous-race coverage is claimed.
