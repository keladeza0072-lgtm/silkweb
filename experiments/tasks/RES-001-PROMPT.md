# RES-001 — Reservation API implementation task

## Objective
Build a **real, runnable HTTP reservation API** with persistent SQLite state.
The completed application must handle concurrent clients and retries safely,
not merely demonstrate in-memory behavior.

Environment: Node.js 24+, TypeScript/ESM, built-in `node:sqlite`. The
identical starter project is supplied to both runs. It contains pinned package
versions, but no implementation of reservations.

## Required external API

The application reads `PORT` (default 3000) and `DB_PATH` (a caller-supplied
absolute SQLite file path). It must create the database file and required
schema automatically. The following staff and service rows must exist after
startup, including across restarts, without duplication:

- Staff ID 1, "Ada"; staff ID 2, "Ben".
- Service ID 1, "Standard cut", exactly 30 minutes.

The HTTP response body is JSON. Every response must have
`Content-Type: application/json`. Invalid JSON or invalid inputs must
return a structured JSON error, never crash the process.

### GET /health

HTTP 200: `{"ok":true}`.

### POST /bookings

Accepts JSON with exact keys:
`{"idempotencyKey":"client-123","staffId":1,"serviceId":1,
"startTime":"2026-11-05T09:00:00.000Z"}`.

On the first successful creation: HTTP 201.
On a replay of the **same key and identical booking payload**: HTTP 200.
Both return a JSON object with:

`{"booking":{"id":1,"staffId":1,"serviceId":1,
"startTime":"2026-11-05T09:00:00.000Z","status":"active"},
"replayed":false}`

(the replay returns `replayed:true`). The original booking ID must
remain the same. IDs are positive integers; do not assume IDs are
sequential in evaluation.

- Different idempotency keys cannot create two active bookings for the same
  staff and start time. The loser returns HTTP 409 with
  `{"error":{"code":"SLOT_CONFLICT"}}`.
- Reuse of a key for a different staff ID, service ID or start time returns
  HTTP 409 with `{"error":{"code":"IDEMPOTENCY_KEY_CONFLICT"}}`.
- Invalid/missing keys, invalid staff/service IDs, and invalid timestamps
  produce HTTP 400 with a nonempty `error.code` string.
- Only canonical UTC half-hour timestamps of the exact form
  `YYYY-MM-DDTHH:mm:00.000Z` with minutes 00 or 30 and real calendar
  dates are valid. Numeric timezone offsets and alternate representations
  of the same instant must be rejected. No restriction on whether slots
  occur in the future is required.
- Different staff may share a slot.
- Idempotency must persist across independent HTTP requests, process
  restarts, and multiple Node processes sharing one SQLite file.
- A SQLite busy timeout may return HTTP 503 and
  `{"error":{"code":"RESERVATION_BUSY"}}`; it must not report success
  for an uncommitted booking.

### POST /bookings/:id/cancel

First cancellation of an active booking returns HTTP 200 and the
updated booking JSON (status `cancelled`) inside `{"booking": ...}`.
Unknown ID returns 404 with `error.code: "BOOKING_NOT_FOUND"`.
A second cancellation returns 409 with `error.code: "BOOKING_STATE_ERROR"`.

A cancelled slot can be booked by a **different new idempotency key**.
Replaying the *original* key after cancellation must return the original
cancelled booking with `replayed:true`; it must never create another
booking.

### GET /bookings/:id

HTTP 200 with `{"booking": ...}`; unknown ID returns HTTP 404 with
`{"error":{"code":"BOOKING_NOT_FOUND"}}`.

For all unspecified routes return JSON HTTP 404. The application must
not leak stack traces or database paths in HTTP error responses.

## Required scripts and behavior

- `npm run build` compiles to runnable ESM JavaScript under `dist/`.
- `npm start` starts the HTTP server; no live-reload or interactive input.
- The service gracefully closes its listener on SIGTERM/SIGINT so a
  harness can stop it.
- Persistent state must survive a restart with the same `DB_PATH`.
- Do not read files outside the supplied starter project unless through
  a tool explicitly enabled for this condition.
- Implement the application yourself. You may use an explicitly exposed
  trusted code-reuse tool if available; verify that reused code works.
- A text-only explanation or pseudocode is not an acceptable deliverable.
