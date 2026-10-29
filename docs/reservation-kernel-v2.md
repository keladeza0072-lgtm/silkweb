# Reservation Kernel V2 — development candidate (UNVERIFIED)

This is an additive extension of the existing certified booking primitives.
It is a development candidate, not an additional certified registry component.
The original mvp-freeze tag, four historical manifests and their evidence files
remain unchanged.

## Code and dependencies

- Source: packages/registry/src/reservationKernelV2.ts
- New tests: packages/registry/tests/booking-reservation-kernel.test.mjs
- Candidate manifest: registry-data/candidates/booking-reservation-kernel-0.2.0.json
- Reuses the existing V1 schema, validation, booking row types and typed errors.
- Node >=24, built-in node:sqlite, pinned existing registry dependencies.

## Behavior

1. initializeReservationKernel(db) must be called once per connection before use.
   It creates the existing V1 tables if needed, a single new idempotency table,
   and configures SQLite foreign keys and a 5000 ms busy timeout.
2. createIdempotentBooking(db, {idempotencyKey, staffId, serviceId, startTime})
   validates a strict ASCII request key and the existing canonical UTC 30-minute
   slot. It returns {booking, replayed}.
3. The same key with identical payload returns the same booking ID; a key with
   different payload raises IDEMPOTENCY_KEY_CONFLICT.
4. The active-slot partial unique index prevents cross-key double booking.
5. cancelReservation(db, bookingId) performs an atomic one-way cancellation.
   Replaying an old key after cancellation returns the cancelled booking.
   Creating a new booking for that freed slot requires a new request key.
6. A SQLITE_BUSY timeout reports RESERVATION_BUSY. A client may retry the SAME
   key and payload; the caller must not assume the failed attempt committed.

The key represents a creation request, not the client's user identity. Callers
must scope keys appropriately for their application (e.g. tenant-specific
prefixes). This prototype uses one shared SQLite file on one host, fixed
30-minute slots, and no distributed lock, cross-host database, or migration
framework. It is not yet production-certified.

## Local verification (no Muse model calls)

In packages/registry, with Node 24 available:

    npm.cmd ci
    npm.cmd run check
    node --test tests/booking-reservation-kernel.test.mjs

The V2 suite launches independent Node processes on the SAME file-backed
SQLite database with a start barrier; this is more meaningful concurrency
coverage than the V1 sequential two-connection test. It is still a bounded,
small race test, not proof for every scheduler/filesystem configuration.

## Trust boundary and controlled certification

The candidate manifest is outside registry-data/manifests intentionally. Until
local certification is promoted, it is NOT served by verified-only MCP tools.

The registry verifier contains a new fixed-command allowlist entry
`registry:reservation-v2-tests`, which executes the V1 booking tests plus
genuine multi-process V2 tests. Its build inventory includes the new V2
compiled module; the existing V1 build-output inventory remains unchanged.

Stage actual observed evidence without touching tracked files:

    cd packages/registry
    npm.cmd run check
    node scripts/certify-reservation-v2.mjs

If the tests and staged evidence validations pass, carefully review the
terminal output. To promote the observed evidence on this **development
worktree only**, rerun:

    node scripts/certify-reservation-v2.mjs --promote

Promotion reruns all five allowlisted certification commands. Only after
success does it refresh four V1 evidence records in the development branch
and add the verified V2 manifest plus evidence. Post-promotion validation
must accept all five components, or the script restores prior records.

**Important:** because the verification runner and package environment
changed, the old V1 evidence would become stale in this development branch
until regenerated. Existing V1 source is unchanged; the historical
`mvp-freeze` Git tag and frozen benchmark evidence remain untouched.
No evidence is backdated or fabricated; the changed development evidence
will show the actual machine and verification timestamps.

After a successful promotion, inspect `git status --short` and
`git diff --stat`. Commit only the newly observed valid evidence and
versioned V2 manifest on this separate branch. RES-001 benchmark design and
held-out evaluator remain separate; do not start paid Muse runs until they
are frozen.
