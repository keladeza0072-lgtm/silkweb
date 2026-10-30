# JOB-001 — SQLite leased background job queue

**State:** planned, unverified; not a trusted Silk Web component.

Node.js 24, TypeScript NodeNext, built-in `DatabaseSync`. Implement `src/jobs.ts`.
Exports: `initializeJobQueue(db): void`, `enqueueJob(db,{key,payload,maxAttempts}):{jobId,replayed}`,
`claimJob(db,{workerId,nowMs,leaseMs}):null|{jobId,payload,attempt,leaseToken,leaseUntilMs}`,
`completeJob(db,{jobId,leaseToken,nowMs}):{completed:boolean}`,
`failJob(db,{jobId,leaseToken,nowMs}):{retried:boolean,dead:boolean}`,
`getJob(db,jobId):null|{status,attempt,maxAttempts}`.

Requirements: keys bind payload+attempt limits permanently; leases are DB-durable;
claim uses an atomic SQLite transaction; only the current unexpired lease token can
complete/fail a job; expired leases permit a new worker to claim; claim after the
attempt limit is exhausted must not run; poison jobs transition to dead-letter.
Supplied nowMs is an explicit nonnegative integer test clock, not Date.now().
Reject invalid inputs with stable errors and never mark a job complete twice.
A genuine two-process collision test must allow at most one valid active claim.
Scope: local durable SQLite queue, not a cross-region distributed scheduler.
