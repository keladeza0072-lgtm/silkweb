# Silk Web Benchmark Task BKG-001 v1.0

Status: FROZEN - BKG-001 v1.0
Task: Implement a barbershop booking HTTP API.

## 1. Technology
- Node.js 24.15.0 and TypeScript.
- SQLite for durable persistence.
- No frontend, authentication, payments, or external services.
- The supplied starter repository and dependency lockfile must be used.
- The application must build with `npm run build` and start with `npm start`.
- Listen on 127.0.0.1 using the PORT environment variable (default 3000).
- Use the BOOKING_DB environment variable as the SQLite database file path.
- Initialize the schema and seed data automatically on a fresh database.
- Restarting with the same database file must preserve existing data.

## 2. Seed data
Staff:
- id 1, name "Amina"
- id 2, name "Tobi"

Service:
- id 1, name "Standard cut", durationMinutes 30

Seed data must not be duplicated after restart.

## 3. Scheduling rules
- All dates and times are UTC.
- Working days are Monday through Friday.
- Working hours are 09:00 through 17:00 UTC.
- Each appointment occupies exactly 30 minutes.
- Valid starting times are 09:00, 09:30, ..., 16:30.
- Saturday and Sunday have no available appointments.
- Start times must use exact canonical form YYYY-MM-DDTHH:mm:00.000Z.
- Dates must exist in the Gregorian calendar.
- Reject offsets, noncanonical timestamps, and off-grid times.
- No future-only booking rule: historical dates are allowed for deterministic testing.
- An active booking occupies one staff member's slot.
- Different staff members may be booked at the same time.
- A cancelled booking no longer occupies its slot.

## 4. JSON HTTP API
All responses must use JSON and appropriate HTTP status codes.

GET /api/health
200: {"ok":true}

GET /api/staff
200: {"staff":[{"id":1,"name":"Amina"},{"id":2,"name":"Tobi"}]}

GET /api/services
200: {"services":[{"id":1,"name":"Standard cut","durationMinutes":30}]}

GET /api/availability?staffId=1&date=2030-01-07
200: {"staffId":1,"date":"2030-01-07","slots":[...]}
- slots contains objects with startTime (string) and available (boolean).
- Return all 16 chronological slots on valid weekdays.
- Return an empty slots array on weekends.
- An occupied active slot has available=false.
- A cancelled slot becomes available=true.

POST /api/bookings
Body: {"staffId":1,"serviceId":1,"startTime":"2030-01-07T09:00:00.000Z"}
201: {"booking":{...}}
- booking contains id, staffId, serviceId, startTime, status.
- A new booking has status "active".
- id is a positive integer unique to that appointment.
- Reject invalid dates, times, staff, services, and conflicts.

GET /api/bookings/:id
200: {"booking":{...}}
- Return active or cancelled appointments.

DELETE /api/bookings/:id
200: {"booking":{...}}
- Cancel an active appointment without deleting its record.
- Return the same id with status "cancelled".
- Repeated cancellation must fail with INVALID_STATE.

PATCH /api/bookings/:id
Body: {"startTime":"2030-01-07T10:00:00.000Z"}
200: {"booking":{...}}
- Rebook an active appointment to a new valid slot.
- Preserve booking id, staffId, and serviceId.
- The move must be atomic.
- On conflict or other failure, preserve the original booking.
- Rebooking to the existing slot is a successful no-op.
- Cancelled appointments cannot be rebooked.

### Contract interpretation (binding)
- Required request fields must have the documented types.
- IDs must be positive safe integers; invalid IDs return INVALID_INPUT.
- Missing required fields and malformed JSON return INVALID_INPUT.
- Unknown valid staff, service, or booking IDs return NOT_FOUND.
- Availability dates must be real Gregorian dates in YYYY-MM-DD form.
- Invalid availability dates return INVALID_INPUT.
- Weekend availability is a successful response with zero slots.
- Booking or rebooking outside working days/hours returns INVALID_INPUT.
- All 16 weekday availability slots are chronological.
- Additional response fields are permitted; documented fields are mandatory.
- Error messages may vary but must be nonempty strings.
- Tests requiring a specific error use one invalid condition per request.
- Rebooking to the existing slot preserves the booking and returns 200.
- Failed rebooking preserves the original booking and its active slot.
- Historical dates are intentionally permitted for deterministic testing.
- No particular source-code structure or component reuse is required.
- The evaluator must assess observable behavior, not implementation style.
## 5. Error contract
Every error response uses:
{"error":{"code":"CODE","message":"Human-readable explanation"}}

Required codes and HTTP statuses:
- INVALID_INPUT: 400 (malformed JSON, invalid fields, times, or dates)
- NOT_FOUND: 404 (unknown staff, service, booking, or route)
- SLOT_CONFLICT: 409 (occupied appointment slot)
- INVALID_STATE: 409 (operation disallowed by booking status)
- INTERNAL_ERROR: 500 (unexpected server failure)

## 6. Integrity and concurrency
- At most one active booking may occupy a given staffId/startTime.
- Simultaneous requests for the same free slot must produce exactly one success.
- Other competing requests must fail without creating duplicate appointments.
- Conflicts must be prevented by durable database-level guarantees.
- Failure during rebooking must never lose the original reservation.
- All successful changes must survive application restart.

## 7. Deliverable
- A runnable TypeScript HTTP application.
- Required scripts and dependencies in the supplied project.
- SQLite persistence and deterministic seed data.
- A short README with build, start, and environment instructions.
- No changes to the evaluator or held-out tests.

## 8. Evaluation rubric (100 points)
- Conflict prevention and concurrency: 25
- Input validation: 15
- Booking and rebooking lifecycle: 15
- Availability calculations: 15
- SQLite persistence: 15
- API contract correctness: 10
- Error handling and resilience: 5

The independent evaluator will apply the same rubric to all conditions.
Held-out assertions are not included in the agent workspace.
No benchmark results are claimed by this document.
