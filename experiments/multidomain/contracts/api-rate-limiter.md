# RATE-001 — Atomic fixed-window API limiter

**State:** planned, unverified; not a trusted Silk Web component.

Node.js 24, TypeScript NodeNext, built-in `DatabaseSync`. Implement `src/rateLimit.ts`.
Exports: `initializeRateLimiter(db):void`,
`admitRequest(db,{tenant,key,limit,windowMs,nowMs}):
{allowed:boolean,remaining:number,resetAtMs:number}`.

Requirements: fixed UTC-epoch aligned windows via floor(nowMs/windowMs);
each tenant/key has independent quotas; positive safe integer limit/windowMs,
nonnegative safe integer nowMs; rejected requests must not increment accepted
count. Within a window, exactly `limit` requests may be allowed; next is
denied, remaining 0, resetAtMs is the next boundary. A new window resets
count. Atomic SQLite writes must prevent oversubscription from separate
processes. Use parameterized SQL; persist window counters across connections.
Reject invalid inputs with `INVALID_INPUT`. Do not claim sliding-window
semantics, global rate limits, or fairness across distributed regions.
