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

## Trust boundary / future certification

The candidate manifest is outside registry-data/manifests intentionally.
It is NOT served by search_verified_components or get_verified_component_source.

To certify, extend the verification allowlist and build-output coverage,
bind the new V2 test file and its compiled output, execute verification on the
actual Node24 environment, and record evidence linked to V2's source hash.
Changes to the existing verification runner may change compiled artifact
hashes for V1: preserve historical evidence and plan any migration carefully.
Never write a fabricated passing evidence record or move this manifest into the
trusted inventory until the current validator independently accepts it.

RES-001 benchmark design and held-out evaluator remain separate and unfrozen.
Do not start paid Muse runs from this development candidate.
