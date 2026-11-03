# Registry reuse record — booking-app

All entries below are observed MCP tool results from this session. Nothing here is invented.

## MCP tool calls

1. `search_verified_components` with `{ "capabilities": ["slot-guard"], "limit": 10 }`
   - Returned one component: `booking-slot-guard@0.1.0`
     (capabilities `booking-creation`, `slot-guard`, `booking-cancellation`;
     stack `node24+sqlite`).
   - Registry totals in the same response: `totalTrusted: 4, rejected: []`.

2. `search_verified_components` with `{ "limit": 25 }` (full inventory)
   - Returned four trusted components, `rejected: []`:
     `booking-schema@0.1.0`, `booking-slot-guard@0.1.0`,
     `booking-validation@0.1.0`, `registry-loader@0.1.0`.

3. `inspect_verified_component` with `{ "id": "booking-slot-guard", "version": "0.1.0" }`
   - `sourcePath: packages/registry/src/slotGuard.ts`
   - Required dependencies: `booking-schema@0.1.0`, `booking-validation@0.1.0`
   - Runtime: stack `node24+sqlite`, node `>=24`, dependencies `{ "zod": "4.6.7" }`
   - Verification: `status: "verified"`,
     `testCommand: "cd packages/registry && npm run check"`,
     `sourceHash: "fe9869a879a83e85e361ee0d5863c1ab303c8f4ed23faaef86813133193eef09"`,
     evidence `registry-data/evidence/booking-slot-guard-0.1.0.json`.
   - Invariants observed: transactional creation with rollback; duplicate
     active same-staff/same-time fails with `SlotConflictError`
     (code `SLOT_CONFLICT`); non-30-minute services fail with
     `BookingReferenceError`; different staff may share a time; cancelling
     frees the slot; concurrency coverage is sequential same-process only.

4. `get_verified_component_source` with `{ "id": "booking-slot-guard", "version": "0.1.0" }`
   - Returned three files, `totalBytes: 12867`, `truncated: false`:
     `packages/registry/src/schema.ts` (3485 bytes),
     `packages/registry/src/slotGuard.ts` (5697 bytes),
     `packages/registry/src/validation.ts` (3685 bytes).

## How the app reuses the registry

- The app imports the existing compiled output
  (`packages/registry/dist/index.js`) via a relative import in
  `apps/booking-app/src/db.ts` and `apps/booking-app/src/app.ts`.
  No booking logic was copied, rewritten, or forked.
- Registry exports used: `createBookingSchema`, `createBooking`,
  `cancelBooking`, `parseBookingInput` (indirectly through `createBooking`),
  plus typed errors `SlotConflictError`, `BookingReferenceError`,
  `BookingNotFoundError`, `BookingStateError`, `BookingValidationError`
  (used for HTTP status mapping). `getBooking` and `listActiveBookings`
  back the registry contract; the app lists bookings with staff/service
  names through its own bounded join query.
- App-only code (not from the registry): HTTP routing, static file
  serving, the demo window (7 UTC dates, 09:00–17:00 UTC business hours,
  future-only rule), seed barbers/services, and the HTML/CSS/JS frontend.
