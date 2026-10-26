# packages/registry

Day-2 slice of Silk Web's Git-backed verified component registry: a barbershop
booking kernel plus a deterministic manifest loader. No vector database,
hosting, payments, or external AI calls.

## Modules

| Module | Source | Description |
|---|---|---|
| booking-schema@0.1.0 | `src/schema.ts` | SQLite tables for staff, services, appointments; database-enforced uniqueness for active bookings of one staff member at one start time (partial unique index). |
| booking-validation@0.1.0 | `src/validation.ts` | Zod-validated booking input plus 30-minute slot constraints. |
| booking-slot-guard@0.1.0 | `src/slotGuard.ts` | Transactional (`BEGIN IMMEDIATE`) booking creation; conflicting reservations fail with `SlotConflictError`; predictable typed errors; cancellation frees the slot for rebooking. |
| registry-loader@0.1.0 | `src/loader.ts`, `src/manifest.ts` | Deterministic loader for JSON manifests with exact version/stack/capabilities/dependency filtering. |

Manifests live in `registry-data/manifests/`. Every manifest's
`verification.status` is `"unverified"` until passing executable tests are
tied to the exact source hash, lockfile/dependency versions and runtime.
No timestamps, test results, or source hashes are fabricated.

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

Collision tests use two independent `DatabaseSync` connections to the same
temporary file-backed database. Execution is sequential same-process, so no
genuine simultaneous-race coverage is claimed.
