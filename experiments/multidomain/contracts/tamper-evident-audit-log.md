# AUD-001 — Tamper-evident hash-chained audit log

**State:** planned, unverified; not a trusted Silk Web component.

Node.js 24, TypeScript NodeNext, built-in crypto and `DatabaseSync`.
Implement `src/auditLog.ts` exporting:
`initializeAuditLog(db):void`,
`appendAuditEvent(db,{stream,eventId,payload}):{sequence,hash}`,
`verifyAuditStream(db,stream,expectedHeadHash):
{valid:boolean,firstBrokenSequence:number|null,headHash:string|null}`,
`getAuditHead(db,stream):null|{sequence,hash}`.

Append-only within the application: records use a deterministic length-prefixed
hash input covering stream, sequence, eventId, exact UTF-8 payload and previous
hash. SHA-256 hash-chain order is strict; per-stream sequence starts at 1;
concurrent writers cannot produce duplicate sequence numbers. eventId is unique
per stream and cannot be mutated or reused for different payloads. Verification
detects modified, missing and reordered interior records. Comparing final head
against independently supplied expectedHeadHash must detect tail deletion.
Never call stored database content itself an immutable external anchor.
Use parameterized SQL and strict input validation; events persist across
connections. No claims of preventing edits by privileged SQLite operators.
