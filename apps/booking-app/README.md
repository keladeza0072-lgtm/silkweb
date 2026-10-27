# Silk Web Barbershop — booking-app (Day 4 vertical slice)

Local-only demo: pick a barber, a service, a UTC date in the next 7 days, and
a free 30-minute slot; bookings persist in a gitignored SQLite file. The
server enforces business hours (09:00–17:00 UTC, last start 16:30 UTC),
future-only times, and the 7-day window; the certified registry owns input
validation, persistence, conflicts, and cancellations.

Limitation: local demo only — no customer accounts, no payments, no
authentication, no public hosting. Anyone who can reach the loopback server
can create and cancel bookings.

## Prerequisites

- Node.js 24 (`node --version` → v24.x)
- Windows PowerShell, run from the repository root

## Install, build, test, run

Build prerequisite: the app reuses the certified registry's compiled
output, so build it first (from the repository root):

```powershell
cd packages/registry
npm install
npm run build
cd ../../apps/booking-app
npm install
npm run build
npm test
npm start
```

Then open `http://127.0.0.1:3000` in a browser.

- `npm test` builds the TypeScript and runs the app suite against
  disposable databases in `tests/tmp/` — never the demo database.
- The demo database lives at `apps/booking-app/data/booking.db`
  (gitignored via `*.db`). Delete that file to reseed the two demo
  barbers and two 30-minute services.
- `PORT` and `BOOKING_DB` environment variables override the port and
  database path, e.g.
  `$env:PORT = "3001"; $env:BOOKING_DB = "C:\demo\bookings.db"; npm start`.

## JSON API (loopback only)

| Method | Path | Result |
|---|---|---|
| `GET` | `/api/health` | `200 {"ok":true}` |
| `GET` | `/api/staff` | `200 {"staff":[...]}` |
| `GET` | `/api/services` | `200 {"services":[...]}` |
| `GET` | `/api/availability?staffId=1&date=YYYY-MM-DD` | `200 {"slots":[{"startTime","booked","past"}]}` (16 slots, UTC) |
| `GET` | `/api/bookings[?staffId=]` | `200 {"bookings":[...]}` (active only, max 200) |
| `POST` | `/api/bookings` `{staffId,serviceId,startTime}` | `201` booked; `409 SLOT_CONFLICT`; `400` invalid/past/off-hours/out-of-window; `404` unknown staff/service |
| `DELETE` | `/api/bookings/:id` | `200` cancelled; `404` unknown; `409` already cancelled |

`startTime` must use the canonical UTC form `YYYY-MM-DDTHH:mm:00.000Z` on
a 30-minute boundary. The server — not cached browser availability —
decides whether a booking succeeds.

## UTC handling

The browser never converts times: dates are UTC calendar days, slots are
built as `date + "T" + HH:mm + ":00.000Z"`, and every displayed time is
labeled UTC. Past slots render disabled but the server re-checks
everything, so clock skew between browser and server cannot create a
double booking.
