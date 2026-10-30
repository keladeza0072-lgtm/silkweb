# INV-BENCH-001 — Inventory Allocation HTTP Service

**Frozen authoring task.** Two clean and identical Node.js 24/TypeScript projects are provided. Implement a working, durable stock-allocation HTTP API for a small merchant. Deliver correct, maintainable code, not test-specific stubs. You are responsible for integrating all functions and independently building the application.

## Agent instructions shared by BOTH conditions

If the environment exposes a **Silk Web MCP Librarian**, use it before coding:
1. Call \`search_verified_components\` for "atomic inventory stock reservation idempotent retries SQLite".
2. If a verified inventory component is available, call \`inspect_verified_component\` to review its contract and \`get_verified_component_source\` to retrieve its fully verified source. Check the response is complete and untruncated.
3. Prefer reusing the certified source **byte-for-byte** at \`src/silkweb/inventory.ts\` and importing it in your application. Do not modify the certified module; write adapters around its API if required.
4. If no certified component is available, implement the required behavior independently. Never claim reuse without actually retrieving and integrating source.

These are conditional instructions. **Do not claim any external tool exists if you cannot see it.** Do not read files outside the supplied application workspace, other candidates, private benchmark/evaluator material, or operator logs. There is no hidden test material in your workspace. You may write your own unit tests. No web browsing. Avoid unnecessary third-party dependencies or dependency upgrades. Run \`npm run build\` and fix any compilation errors before finishing.

## Required behavior

Build one executable \`src/server.ts\` with a Node.js built-in \`node:http\` listener. Use persistent \`node:sqlite\` \`DatabaseSync\`; do not substitute in-memory stock, JSON files, mock state, or a remote database.

The application uses **one SKU per reservation**, not shopping-cart-wide atomic orders. All SQL must be parameterized. Each process initializes the schema when starting. API state must survive process restarts, and independent server processes sharing the same SQLite file must not oversell.

Environment:
- \`INVENTORY_DB_PATH\`: absolute path to SQLite DB file (present in the evaluator); use it to open persistent state.
- \`PORT\`: numeric TCP listening port; \`0\` means request an ephemeral port.
- Listen on \`127.0.0.1\`.
- When ready to accept requests, write exactly one STDOUT line: \`SILKWEB_READY {"port":NNNN}\` where NNNN is the actual positive numeric TCP port. Debug output is allowed on STDERR only.
- Start with \`npm run build\`, then \`node dist/server.js\`. No external services.

Every successful JSON response must include \`Content-Type: application/json\`. Every error body is \`{"error":{"code":"SOME_CODE"}}\` (additional fields allowed); never expose stack traces or SQL queries to clients.

### Endpoints

| Method + path | Success response | Semantics |
| --- | --- | --- |
| \`GET /health\` | 200 \`{"ok":true,"service":"inventory-api"}\` | Health/readiness |
| \`POST /v1/stock\` | 201 \`{"sku":"A","available":5}\` | Body: \`{"sku":"A","available":5}\`; create a SKU only once |
| \`GET /v1/stock/:sku\` | 200 \`{"sku":"A","available":5}\` | Return persisted stock quantity |
| \`GET /v1/stock\` | 200 \`{"items":[{"sku":"A","available":5}]}\` | Return ALL stock rows sorted by SKU ascending (deterministic) |
| \`POST /v1/reservations\` | 201 new, 200 replay: \`{"reservationId":1,"replayed":false,"available":3}\` | Body \`{"key":"request-1","sku":"A","quantity":2}\` |
| \`POST /v1/reservations/:id/release\` | 200 \`{"released":true,"available":5}\` | First call releases exactly once; next call returns \`released:false\` |

A reservation key permanently binds to an exact SKU and quantity; exact retry never subtracts twice, including after release. Reusing a key for different content must not mutate stock. Two different keys cannot simultaneously allocate the final unit. A failed insufficient-stock request does not consume its idempotency key.

Validation and HTTP errors:
- JSON request bodies only; \`Content-Type: application/json\` for the three POST actions with bodies.
- Body greater than **65536 UTF-8 bytes**: 413 \`PAYLOAD_TOO_LARGE\`.
- Malformed JSON: 400 \`INVALID_JSON\`.
- Non-JSON Content-Type on body-bearing POST: 415 \`UNSUPPORTED_MEDIA_TYPE\`.
- Empty, non-ASCII, or longer than 128-character SKU/key: 400 \`INVALID_INPUT\`. Printable ASCII strings 1–128 characters are permitted; no SQL injection.
- Initial stock is a **nonnegative safe integer**, including zero. Reservation quantity is a **positive safe integer**.
- Unknown SKU: 404 \`STOCK_NOT_FOUND\`; unknown reservation: 404 \`RESERVATION_NOT_FOUND\`.
- Existing SKU: 409 \`STOCK_EXISTS\`; insufficient stock: 409 \`INSUFFICIENT_STOCK\`; reused key with different SKU/quantity: 409 \`IDEMPOTENCY_CONFLICT\`.
- Unknown route or method: 404 \`NOT_FOUND\`.
- Avoid crashing the process on client errors; avoid accepting unsafe numeric inputs.

## Exit requirements

The goal is a **real working inventory-powered application**, not merely a library with passing unit tests. Use genuine SQLite transactions for correctness across multiple Node processes. Do not circumvent errors by mutating tests, writing special cases for an evaluator, or making a route return fabricated stock values. The independent scorer measures **black-box HTTP behavior**, actual concurrency, restart durability, and application compilation. If you use Silk Web, its source reuse will be verified separately by source hashes and static import reachability.

Your answer should summarize implementation and known limitations without inventing verification.
