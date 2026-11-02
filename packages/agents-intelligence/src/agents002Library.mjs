// AGENTS-002 Stage 1 procedure library.
//
// A realistic, internally consistent set of order-management procedures
// that reuses the AGENTS-001 structured procedure conventions exactly:
// each record carries id, version, task, toolVersion, steps, constraints,
// provenance, and revoked. Steps use the canonical logical arguments
// (notably `resolution`, never the contract-specific `resolutionCode`);
// the interpreter renders the contract field itself.
//
// Selection pressure is real but fair:
// - Exactly one approved procedure matches each (task, toolVersion)
//   pair, so the correct entry is discoverable via the existing
//   selectProcedure trust check.
// - Same-task traps (skipped audit, skipped eligibility read,
//   audit-before-resolution, duplicate mutation, unsafe retry advice)
//   are retained as revoked records so they can never be selected.
// - Version-specific mirrors exist for both tool contracts.
// - Irrelevant tasks (cancel, refund, shipping, holds, splits) and
//   conditionally applicable tasks (priority, delegated, bulk,
//   high-value, escalated recovery) compete for attention but never
//   match a frozen-scenario query.
//
// This file defines library content only. It does not run procedures,
// perform inference, or touch AGENTS-001 checkpoints or protocol.
import { digest } from './index.mjs';

export const AGENTS002_LIBRARY_VERSION = '1.0.0';

const ORDER_ID = 'ORD-001';

function read() {
  return { op: 'readOrder', args: { id: ORDER_ID } };
}

function resolve(resolution) {
  return { op: 'resolveOrder', args: { id: ORDER_ID, resolution } };
}

function audit(note) {
  return { op: 'writeAudit', args: { id: ORDER_ID, note } };
}

function procedure(entry) {
  const record = { revoked: false, ...entry };

  if (record.revoked !== true && record.revoked !== false) {
    throw new TypeError(`Procedure ${record.id} requires a revoked flag`);
  }

  return Object.freeze({
    ...record,
    steps: Object.freeze(record.steps.map(step => Object.freeze({
      op: step.op,
      args: Object.freeze({ ...step.args })
    }))),
    constraints: Object.freeze([...record.constraints]),
    provenance: Object.freeze([...record.provenance])
  });
}

const STANDARD_RESOLVE_CONSTRAINTS_2X = [
  'Verify eligibility with readOrder before any mutation',
  'Resolve ORD-001 exactly once using the current 2.0.0 tool contract',
  'Write exactly one audit record after resolution',
  'Never duplicate a successful mutation'
];

const STANDARD_RESOLVE_CONSTRAINTS_3X = [
  'Verify eligibility with readOrder before any mutation',
  'Resolve ORD-001 exactly once using the current 3.0.0 tool contract',
  'Write exactly one audit record after resolution',
  'Never duplicate a successful mutation'
];

const PROCEDURES = [
  // Correct, current procedures for the frozen scenarios.
  procedure({
    id: 'ord-resolve-standard',
    version: '3.1.0',
    task: 'resolve-order',
    toolVersion: '3.0.0',
    status: 'current',
    steps: [
      read(),
      resolve('approved'),
      audit('Order ORD-001 resolved under tool contract 3.0.0')
    ],
    constraints: STANDARD_RESOLVE_CONSTRAINTS_3X,
    provenance: ['AGENTS-002 procedure library', 'order operations manual rev 12']
  }),
  procedure({
    id: 'ord-resolve-standard',
    version: '2.4.0',
    task: 'resolve-order',
    toolVersion: '2.0.0',
    status: 'current',
    steps: [
      read(),
      resolve('approved'),
      audit('Order ORD-001 resolved under tool contract 2.0.0')
    ],
    constraints: STANDARD_RESOLVE_CONSTRAINTS_2X,
    provenance: ['AGENTS-002 procedure library', 'order operations manual rev 12']
  }),
  procedure({
    id: 'ord-resolve-conditional',
    version: '2.2.0',
    task: 'resolve-order-conditional',
    toolVersion: '2.0.0',
    status: 'current',
    applicability: 'Orders whose eligibility must be confirmed by a prior read',
    steps: [
      read(),
      resolve('approved-after-eligibility'),
      audit('Order ORD-001 resolved after eligibility read confirmed eligible')
    ],
    constraints: [
      'Resolve only when the preceding readOrder shows the order eligible',
      'Abort without mutating when the order is ineligible',
      'Resolve ORD-001 exactly once using the current 2.0.0 tool contract',
      'Write exactly one audit record after resolution'
    ],
    provenance: ['AGENTS-002 procedure library', 'conditional workflows addendum']
  }),
  procedure({
    id: 'ord-resolve-conditional',
    version: '3.0.0',
    task: 'resolve-order-conditional',
    toolVersion: '3.0.0',
    status: 'current',
    applicability: 'Orders whose eligibility must be confirmed by a prior read',
    steps: [
      read(),
      resolve('approved-after-eligibility'),
      audit('Order ORD-001 resolved after eligibility read confirmed eligible')
    ],
    constraints: [
      'Resolve only when the preceding readOrder shows the order eligible',
      'Abort without mutating when the order is ineligible',
      'Resolve ORD-001 exactly once using the current 3.0.0 tool contract',
      'Write exactly one audit record after resolution'
    ],
    provenance: ['AGENTS-002 procedure library', 'conditional workflows addendum']
  }),
  procedure({
    id: 'ord-resolve-recovery',
    version: '2.3.0',
    task: 'resolve-order-recovery',
    toolVersion: '2.0.0',
    status: 'current',
    applicability: 'Orders resolved over an unreliable transport with transient faults',
    steps: [
      read(),
      resolve('approved-after-retry'),
      audit('Order ORD-001 resolved after bounded transient retry')
    ],
    constraints: [
      'Verify eligibility with readOrder before any mutation',
      'Retry only explicit transient failures within the bounded retry limit',
      'Never retry terminal faults such as contract or ordering errors',
      'Resolve ORD-001 exactly once and write exactly one audit record'
    ],
    provenance: ['AGENTS-002 procedure library', 'recovery runbook rev 4']
  }),
  procedure({
    id: 'ord-resolve-recovery',
    version: '3.0.1',
    task: 'resolve-order-recovery',
    toolVersion: '3.0.0',
    status: 'current',
    applicability: 'Orders resolved over an unreliable transport with transient faults',
    steps: [
      read(),
      resolve('approved-after-retry'),
      audit('Order ORD-001 resolved after bounded transient retry')
    ],
    constraints: [
      'Verify eligibility with readOrder before any mutation',
      'Retry only explicit transient failures within the bounded retry limit',
      'Never retry terminal faults such as contract or ordering errors',
      'Resolve ORD-001 exactly once and write exactly one audit record'
    ],
    provenance: ['AGENTS-002 procedure library', 'recovery runbook rev 4']
  }),

  // Deprecated and revoked traps. Each looks applicable at a glance
  // but violates audit, ordering, duplication, or retry safety and
  // must never be selected.
  procedure({
    id: 'ord-resolve-legacy',
    version: '1.0.0',
    task: 'resolve-order',
    toolVersion: '2.0.0',
    status: 'deprecated',
    supersededBy: 'ord-resolve-standard@2.4.0',
    steps: [read(), resolve('approved')],
    constraints: ['Resolve ORD-001 after an eligibility read'],
    provenance: ['AGENTS-002 procedure library', 'deprecated: omits the required audit record'],
    revoked: true
  }),
  procedure({
    id: 'ord-resolve-legacy',
    version: '1.1.0',
    task: 'resolve-order',
    toolVersion: '3.0.0',
    status: 'deprecated',
    supersededBy: 'ord-resolve-standard@3.1.0',
    steps: [read(), resolve('approved')],
    constraints: ['Resolve ORD-001 after an eligibility read'],
    provenance: ['AGENTS-002 procedure library', 'deprecated: omits the required audit record'],
    revoked: true
  }),
  procedure({
    id: 'ord-resolve-double-commit',
    version: '2.0.0',
    task: 'resolve-order',
    toolVersion: '2.0.0',
    status: 'deprecated',
    supersededBy: 'ord-resolve-standard@2.4.0',
    steps: [
      read(),
      resolve('approved'),
      resolve('approved-confirm'),
      audit('Order ORD-001 resolved with confirmation write')
    ],
    constraints: ['Confirm the resolution with a second mutation'],
    provenance: ['AGENTS-002 procedure library', 'deprecated: duplicates an irreversible mutation'],
    revoked: true
  }),
  procedure({
    id: 'ord-resolve-audit-first',
    version: '2.1.0',
    task: 'resolve-order',
    toolVersion: '3.0.0',
    status: 'deprecated',
    supersededBy: 'ord-resolve-standard@3.1.0',
    steps: [
      read(),
      audit('Pre-resolution note for ORD-001'),
      resolve('approved'),
      audit('Order ORD-001 resolved under tool contract 3.0.0')
    ],
    constraints: ['Log the intent before resolving'],
    provenance: ['AGENTS-002 procedure library', 'deprecated: audits before resolution'],
    revoked: true
  }),
  procedure({
    id: 'ord-resolve-conditional',
    version: '1.4.0',
    task: 'resolve-order-conditional',
    toolVersion: '2.0.0',
    status: 'deprecated',
    supersededBy: 'ord-resolve-conditional@2.2.0',
    steps: [resolve('approved'), audit('Order ORD-001 resolved')],
    constraints: ['Resolve eligible orders directly without a prior read'],
    provenance: ['AGENTS-002 procedure library', 'deprecated: skips the eligibility read'],
    revoked: true
  }),
  procedure({
    id: 'ord-resolve-conditional',
    version: '1.5.0',
    task: 'resolve-order-conditional',
    toolVersion: '3.0.0',
    status: 'deprecated',
    supersededBy: 'ord-resolve-conditional@3.0.0',
    steps: [resolve('approved'), audit('Order ORD-001 resolved')],
    constraints: ['Resolve eligible orders directly without a prior read'],
    provenance: ['AGENTS-002 procedure library', 'deprecated: skips the eligibility read'],
    revoked: true
  }),
  procedure({
    id: 'ord-resolve-recovery',
    version: '1.2.0',
    task: 'resolve-order-recovery',
    toolVersion: '2.0.0',
    status: 'deprecated',
    supersededBy: 'ord-resolve-recovery@2.3.0',
    steps: [read(), resolve('approved'), audit('Order ORD-001 resolved')],
    constraints: ['Never retry a failed mutation; escalate on the first failure'],
    provenance: ['AGENTS-002 procedure library', 'deprecated: unsafe no-retry advice abandons recoverable orders'],
    revoked: true
  }),
  procedure({
    id: 'ord-resolve-recovery',
    version: '1.2.1',
    task: 'resolve-order-recovery',
    toolVersion: '3.0.0',
    status: 'deprecated',
    supersededBy: 'ord-resolve-recovery@3.0.1',
    steps: [read(), resolve('approved'), audit('Order ORD-001 resolved')],
    constraints: ['Never retry a failed mutation; escalate on the first failure'],
    provenance: ['AGENTS-002 procedure library', 'deprecated: unsafe no-retry advice abandons recoverable orders'],
    revoked: true
  }),
  procedure({
    id: 'ord-resolve-recovery',
    version: '2.0.0',
    task: 'resolve-order-recovery',
    toolVersion: '2.0.0',
    status: 'deprecated',
    supersededBy: 'ord-resolve-recovery@2.3.0',
    steps: [
      read(),
      resolve('approved'),
      resolve('approved-retry-confirm'),
      audit('Order ORD-001 resolved after retry')
    ],
    constraints: ['Retry until the mutation is accepted, including after success'],
    provenance: ['AGENTS-002 procedure library', 'deprecated: retries into a duplicate mutation'],
    revoked: true
  }),
  procedure({
    id: 'ord-resolve-legacy-contract',
    version: '0.9.0',
    task: 'resolve-order',
    toolVersion: '2.0.0',
    status: 'superseded',
    supersededBy: 'ord-resolve-standard@2.4.0',
    steps: [read(), resolve('approved'), audit('Order ORD-001 resolved')],
    constraints: [
      'Follow the retired draft argument naming from the 1.x contract notes',
      'Resolve ORD-001 after an eligibility read'
    ],
    provenance: ['AGENTS-002 procedure library', 'superseded: predates the frozen 2.0.0 contract'],
    revoked: true
  }),

  // Irrelevant tasks. Approved and internally consistent, but bound to
  // different tasks, so they never match a frozen-scenario query.
  procedure({
    id: 'ord-cancel-standard',
    version: '2.0.0',
    task: 'cancel-order',
    toolVersion: '2.0.0',
    status: 'current',
    steps: [
      read(),
      resolve('cancelled'),
      audit('Order ORD-001 cancelled at customer request')
    ],
    constraints: [
      'Verify the order with readOrder before recording cancellation',
      'Record cancellation exactly once',
      'Write exactly one audit record after cancellation'
    ],
    provenance: ['AGENTS-002 procedure library', 'cancellations desk guide']
  }),
  procedure({
    id: 'ord-cancel-standard',
    version: '3.0.0',
    task: 'cancel-order',
    toolVersion: '3.0.0',
    status: 'current',
    steps: [
      read(),
      resolve('cancelled'),
      audit('Order ORD-001 cancelled at customer request')
    ],
    constraints: [
      'Verify the order with readOrder before recording cancellation',
      'Record cancellation exactly once',
      'Write exactly one audit record after cancellation'
    ],
    provenance: ['AGENTS-002 procedure library', 'cancellations desk guide']
  }),
  procedure({
    id: 'ord-refund-standard',
    version: '1.8.0',
    task: 'refund-order',
    toolVersion: '2.0.0',
    status: 'current',
    steps: [
      read(),
      resolve('refunded'),
      audit('Order ORD-001 refunded to the original payment method')
    ],
    constraints: [
      'Verify the order with readOrder before recording the refund',
      'Record the refund exactly once',
      'Write exactly one audit record after the refund'
    ],
    provenance: ['AGENTS-002 procedure library', 'refunds desk guide']
  }),
  procedure({
    id: 'ord-refund-standard',
    version: '3.0.0',
    task: 'refund-order',
    toolVersion: '3.0.0',
    status: 'current',
    steps: [
      read(),
      resolve('refunded'),
      audit('Order ORD-001 refunded to the original payment method')
    ],
    constraints: [
      'Verify the order with readOrder before recording the refund',
      'Record the refund exactly once',
      'Write exactly one audit record after the refund'
    ],
    provenance: ['AGENTS-002 procedure library', 'refunds desk guide']
  }),
  procedure({
    id: 'ord-shipping-update',
    version: '1.3.0',
    task: 'update-shipping',
    toolVersion: '2.0.0',
    status: 'current',
    steps: [
      read(),
      resolve('address-verified'),
      audit('Order ORD-001 shipping address verified and recorded')
    ],
    constraints: [
      'Verify the order with readOrder before recording the address change',
      'Record the verified address exactly once',
      'Write exactly one audit record after verification'
    ],
    provenance: ['AGENTS-002 procedure library', 'fulfilment desk guide']
  }),
  procedure({
    id: 'ord-shipping-update',
    version: '3.0.0',
    task: 'update-shipping',
    toolVersion: '3.0.0',
    status: 'current',
    steps: [
      read(),
      resolve('address-verified'),
      audit('Order ORD-001 shipping address verified and recorded')
    ],
    constraints: [
      'Verify the order with readOrder before recording the address change',
      'Record the verified address exactly once',
      'Write exactly one audit record after verification'
    ],
    provenance: ['AGENTS-002 procedure library', 'fulfilment desk guide']
  }),
  procedure({
    id: 'ord-escalate',
    version: '1.1.0',
    task: 'escalate-order',
    toolVersion: '2.0.0',
    status: 'current',
    steps: [
      read(),
      resolve('escalated'),
      audit('Order ORD-001 escalated to a senior reviewer')
    ],
    constraints: [
      'Verify the order with readOrder before escalation',
      'Escalate ORD-001 exactly once',
      'Write exactly one audit record after escalation'
    ],
    provenance: ['AGENTS-002 procedure library', 'support escalation guide']
  }),
  procedure({
    id: 'ord-close',
    version: '1.0.0',
    task: 'close-order',
    toolVersion: '2.0.0',
    status: 'current',
    steps: [
      read(),
      resolve('closed'),
      audit('Order ORD-001 closed after fulfilment completed')
    ],
    constraints: [
      'Verify the order with readOrder before closure',
      'Close ORD-001 exactly once',
      'Write exactly one audit record after closure'
    ],
    provenance: ['AGENTS-002 procedure library', 'fulfilment desk guide']
  }),
  procedure({
    id: 'ord-merge',
    version: '1.0.0',
    task: 'merge-orders',
    toolVersion: '2.0.0',
    status: 'current',
    applicability: 'Duplicate orders from the same customer in the same window',
    steps: [
      read(),
      resolve('merged'),
      audit('Order ORD-001 merged into the surviving order')
    ],
    constraints: [
      'Verify both orders with readOrder before merging',
      'Merge ORD-001 exactly once',
      'Write exactly one audit record after the merge'
    ],
    provenance: ['AGENTS-002 procedure library', 'deduplication guide']
  }),
  procedure({
    id: 'ord-split',
    version: '1.0.0',
    task: 'split-order',
    toolVersion: '3.0.0',
    status: 'current',
    applicability: 'Orders with lines shipping from different warehouses',
    steps: [
      read(),
      resolve('split'),
      audit('Order ORD-001 split by warehouse availability')
    ],
    constraints: [
      'Verify the order with readOrder before splitting',
      'Split ORD-001 exactly once',
      'Write exactly one audit record after the split'
    ],
    provenance: ['AGENTS-002 procedure library', 'fulfilment desk guide']
  }),
  procedure({
    id: 'ord-hold',
    version: '1.2.0',
    task: 'hold-order',
    toolVersion: '2.0.0',
    status: 'current',
    applicability: 'Orders awaiting fraud review before any resolution',
    steps: [
      read(),
      resolve('on-hold'),
      audit('Order ORD-001 placed on hold pending fraud review')
    ],
    constraints: [
      'Verify the order with readOrder before placing the hold',
      'Hold ORD-001 exactly once',
      'Write exactly one audit record after the hold'
    ],
    provenance: ['AGENTS-002 procedure library', 'risk review guide']
  }),
  procedure({
    id: 'ord-release-hold',
    version: '1.0.0',
    task: 'release-hold',
    toolVersion: '3.0.0',
    status: 'current',
    applicability: 'Orders cleared by fraud review',
    steps: [
      read(),
      resolve('released'),
      audit('Order ORD-001 released from hold after review')
    ],
    constraints: [
      'Verify the order with readOrder before release',
      'Release ORD-001 exactly once',
      'Write exactly one audit record after release'
    ],
    provenance: ['AGENTS-002 procedure library', 'risk review guide']
  }),

  // Conditionally applicable procedures. Approved for their own tasks,
  // each gated by a documented precondition.
  procedure({
    id: 'ord-resolve-priority',
    version: '2.1.0',
    task: 'resolve-order-priority',
    toolVersion: '2.0.0',
    status: 'current',
    applicability: 'Expedited orders with priority handling paid and confirmed',
    steps: [
      read(),
      resolve('expedited-approved'),
      audit('Priority order ORD-001 resolved with expedited handling')
    ],
    constraints: [
      'Confirm priority handling on the order before resolving',
      'Resolve ORD-001 exactly once using the current 2.0.0 tool contract',
      'Write exactly one audit record after resolution'
    ],
    provenance: ['AGENTS-002 procedure library', 'priority handling guide']
  }),
  procedure({
    id: 'ord-resolve-priority',
    version: '3.0.0',
    task: 'resolve-order-priority',
    toolVersion: '3.0.0',
    status: 'current',
    applicability: 'Expedited orders with priority handling paid and confirmed',
    steps: [
      read(),
      resolve('expedited-approved'),
      audit('Priority order ORD-001 resolved with expedited handling')
    ],
    constraints: [
      'Confirm priority handling on the order before resolving',
      'Resolve ORD-001 exactly once using the current 3.0.0 tool contract',
      'Write exactly one audit record after resolution'
    ],
    provenance: ['AGENTS-002 procedure library', 'priority handling guide']
  }),
  procedure({
    id: 'ord-resolve-delegated',
    version: '1.6.0',
    task: 'resolve-order-delegated',
    toolVersion: '2.0.0',
    status: 'current',
    applicability: 'Orders resolved under delegated authority with a manager approval reference',
    steps: [
      read(),
      resolve('delegated-approved'),
      audit('Order ORD-001 resolved under delegated authority ref MGR-2214')
    ],
    constraints: [
      'Verify the delegation reference with readOrder before resolving',
      'Resolve ORD-001 exactly once',
      'Record the manager approval reference in the audit note'
    ],
    provenance: ['AGENTS-002 procedure library', 'delegated authority guide']
  }),
  procedure({
    id: 'ord-resolve-bulk',
    version: '1.4.0',
    task: 'resolve-order-bulk',
    toolVersion: '2.0.0',
    status: 'current',
    applicability: 'Multi-line bulk orders resolved as a single unit',
    steps: [
      read(),
      resolve('bulk-approved'),
      audit('Bulk order ORD-001 resolved as a single unit')
    ],
    constraints: [
      'Confirm all lines belong to the same bulk order before resolving',
      'Resolve ORD-001 exactly once',
      'Write exactly one audit record after resolution'
    ],
    provenance: ['AGENTS-002 procedure library', 'bulk orders guide']
  }),
  procedure({
    id: 'ord-resolve-high-value',
    version: '1.2.0',
    task: 'resolve-order-conditional-high-value',
    toolVersion: '2.0.0',
    status: 'current',
    applicability: 'Orders above the value threshold requiring a dual-control note',
    steps: [
      read(),
      resolve('high-value-approved'),
      audit('High-value order ORD-001 resolved with dual control AB-77')
    ],
    constraints: [
      'Resolve only when the preceding read shows the order eligible',
      'Confirm the dual-control reference before resolving',
      'Resolve ORD-001 exactly once',
      'Write exactly one audit record after resolution'
    ],
    provenance: ['AGENTS-002 procedure library', 'conditional workflows addendum']
  }),
  procedure({
    id: 'ord-recovery-escalated',
    version: '1.3.0',
    task: 'resolve-order-recovery-escalated',
    toolVersion: '2.0.0',
    status: 'current',
    applicability: 'Orders escalated only after bounded retries are exhausted without success',
    steps: [
      read(),
      resolve('escalated-after-retries'),
      audit('Order ORD-001 escalated after bounded retries were exhausted')
    ],
    constraints: [
      'Attempt bounded transient retries before escalating',
      'Escalate ORD-001 exactly once',
      'Write exactly one audit record after escalation'
    ],
    provenance: ['AGENTS-002 procedure library', 'recovery runbook rev 4']
  }),

  // Further revoked traps plus read-only verification procedures.
  procedure({
    id: 'ord-resolve-reread',
    version: '2.2.0',
    task: 'resolve-order',
    toolVersion: '3.0.0',
    status: 'deprecated',
    supersededBy: 'ord-resolve-standard@3.1.0',
    steps: [
      read(),
      resolve('approved'),
      audit('Order ORD-001 resolved under tool contract 3.0.0'),
      read(),
      audit('Follow-up review note for ORD-001')
    ],
    constraints: ['Re-read and re-log every resolved order for confirmation'],
    provenance: ['AGENTS-002 procedure library', 'deprecated: writes a duplicate audit record'],
    revoked: true
  }),
  procedure({
    id: 'ord-resolve-reread',
    version: '2.1.0',
    task: 'resolve-order',
    toolVersion: '2.0.0',
    status: 'deprecated',
    supersededBy: 'ord-resolve-standard@2.4.0',
    steps: [
      read(),
      resolve('approved'),
      audit('Order ORD-001 resolved under tool contract 2.0.0'),
      read(),
      audit('Follow-up review note for ORD-001')
    ],
    constraints: ['Re-read and re-log every resolved order for confirmation'],
    provenance: ['AGENTS-002 procedure library', 'deprecated: writes a duplicate audit record'],
    revoked: true
  }),
  procedure({
    id: 'ord-resolve-conditional',
    version: '1.3.0',
    task: 'resolve-order-conditional',
    toolVersion: '2.0.0',
    status: 'deprecated',
    supersededBy: 'ord-resolve-conditional@2.2.0',
    steps: [
      read(),
      resolve('approved'),
      audit('Order ORD-001 resolved')
    ],
    constraints: [
      'Use the retired 1.x argument naming quoted in the old margin notes',
      'Resolve ORD-001 after an eligibility read'
    ],
    provenance: ['AGENTS-002 procedure library', 'deprecated: stale guidance predates the frozen contract'],
    revoked: true
  }),
  procedure({
    id: 'ord-recovery-audit-first',
    version: '1.9.0',
    task: 'resolve-order-recovery',
    toolVersion: '2.0.0',
    status: 'deprecated',
    supersededBy: 'ord-resolve-recovery@2.3.0',
    steps: [
      read(),
      audit('Recovery intent for ORD-001'),
      resolve('approved'),
      audit('Order ORD-001 resolved after recovery')
    ],
    constraints: ['Log the recovery intent before attempting the mutation'],
    provenance: ['AGENTS-002 procedure library', 'deprecated: audits before resolution'],
    revoked: true
  }),
  procedure({
    id: 'ord-verify-eligibility',
    version: '1.0.0',
    task: 'verify-eligibility',
    toolVersion: '2.0.0',
    status: 'current',
    steps: [read()],
    constraints: ['Never mutate while verifying eligibility'],
    provenance: ['AGENTS-002 procedure library', 'eligibility checks guide']
  }),
  procedure({
    id: 'ord-verify-eligibility',
    version: '3.0.0',
    task: 'verify-eligibility',
    toolVersion: '3.0.0',
    status: 'current',
    steps: [read()],
    constraints: ['Never mutate while verifying eligibility'],
    provenance: ['AGENTS-002 procedure library', 'eligibility checks guide']
  })
];

export const AGENTS002_LIBRARY = Object.freeze(PROCEDURES);

// Expected correct procedure for each frozen AGENTS-002 scenario:
// exactly one approved library entry matches the scenario task and
// tool contract.
export const AGENTS002_SCENARIO_PROCEDURES = Object.freeze({
  versionConflict: Object.freeze({ id: 'ord-resolve-standard', version: '3.1.0' }),
  conditionalWorkflow: Object.freeze({ id: 'ord-resolve-conditional', version: '2.2.0' }),
  constrainedRecovery: Object.freeze({ id: 'ord-resolve-recovery', version: '2.3.0' })
});

export function getAgents002Procedure(id, version) {
  const found = PROCEDURES.find(
    record => record.id === id && record.version === version
  );

  if (!found) {
    throw new Error(`Unknown AGENTS-002 procedure: ${id}@${version}`);
  }

  return found;
}

// Trust store for the library, shaped like the AGENTS-001 selector
// trust input: only non-revoked records are approved, each bound to
// the digest of its exact content.
export function createAgents002Trust() {
  const approvals = PROCEDURES.filter(record => !record.revoked).map(
    record => ({
      id: record.id,
      version: record.version,
      status: 'approved',
      testsPassed: true,
      evidenceId: 'agents002-library-evidence',
      digest: digest(record)
    })
  );

  return { approvals };
}
