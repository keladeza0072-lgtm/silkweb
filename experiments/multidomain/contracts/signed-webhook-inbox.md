# WHK-001 — Certified candidate: Signed webhook inbox

**State:** not implemented, not verified, not in trusted registry.

## Runtime and export contract

Node.js >=24, TypeScript NodeNext, `node:sqlite` `DatabaseSync`, `node:crypto`.
No HTTP server, network calls, or third-party dependencies required.
Implement precisely `src/webhooks.ts` with synchronous exports:

- `initializeWebhookInbox(db: DatabaseSync): void` — idempotent durable schema setup.
- `acceptWebhook(db: DatabaseSync, input: {provider: string, eventId: string, payload: string, signature: string, secret: string}): {accepted: true, duplicate: boolean}`.
- `getWebhookState(db: DatabaseSync, provider: string, eventId: string): null | {status: 'pending'|'processed', payloadSha256: string}`.
- `markWebhookProcessed(db: DatabaseSync, provider: string, eventId: string): {processed: boolean}`.

The signature is `sha256=<64 lowercase hex chars>`, computed using HMAC-SHA256
with `secret` as UTF-8 key and the **exact UTF-8 bytes** of `payload`.
Malformed signatures and invalid HMAC values must throw an Error with
`.code === 'INVALID_SIGNATURE'`.
Other errors: `INVALID_INPUT`, `EVENT_CONFLICT`, `EVENT_NOT_FOUND`.
Input `provider`, `eventId`, and `secret` must be nonempty strings.
Reject empty/malformed event identifiers. Never log or persist the secret.

## Exact invariants

1. Authenticity check happens **before** any new/duplicate acceptance. A valid previously seen `eventId` with an invalid signature must still be rejected.
2. Deduplicate by the composite key `(provider,eventId)`. Exact repeat of a signed event returns `{accepted:true,duplicate:true}`, without resetting a processed event.
3. Reuse of an existing provider/eventId with different **verified** payload must throw `EVENT_CONFLICT`.
4. Different providers may use the same event ID independently.
5. First acceptance stores a SHA-256 digest of exact payload bytes and `pending` status. `getWebhookState` returns the persisted state.
6. `markWebhookProcessed` transitions pending to processed exactly once. A second call returns `processed:false`; unknown event throws `EVENT_NOT_FOUND`.
7. Use SQLite transactions or uniqueness constraints for concurrent writers. SQL parameters must be bound safely.
8. Persist across closing and reopening the SQLite file.

## Evaluation

Held-out checks cover valid/invalid signatures, arbitrary UTF-8 payloads,
duplicate delivery, payload conflict, tenant isolation, processing replay and
persistence. This is an authenticated local inbox **not** proof of
exactly-once downstream payment processing.

The evaluator is operator-only. Do not read its source during paid Muse
development. `src/webhooks.ts` is the sole required output.
