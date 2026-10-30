# FLOW-001 — Durable idempotent workflow transitions

**State:** planned, unverified; not a trusted Silk Web component.

Node.js 24, TypeScript NodeNext, `DatabaseSync`. Implement `src/workflow.ts`.
Exports: `initializeWorkflow(db):void`,
`createWorkflow(db,{id}):{id,state:'draft',revision:0}`,
`transitionWorkflow(db,{id,action,expectedRevision,key}):
{id,state,revision,replayed:boolean}`,
`getWorkflow(db,id):null|{id,state,revision}`.

Finite state graph:
draft --submit--> submitted
submitted --approve--> approved
submitted --reject--> rejected
rejected --reopen--> draft
approved is terminal.

Successful transitions increment revision exactly once. A key binds to one
exact workflow ID, action, and expectedRevision; exact retries return the same
transition outcome without incrementing the revision. Invalid transitions
throw INVALID_TRANSITION, stale optimistic revision REVISION_CONFLICT, and key
reuse with modified request IDEMPOTENCY_CONFLICT; no state mutation. Atomic
transactions prevent two writers from both winning a revision. Store state
and replay keys durably; reject malformed inputs.
Scope: one predefined graph, not user-defined workflow orchestration.
