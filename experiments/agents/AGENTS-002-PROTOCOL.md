# AGENTS-002 - Frozen Experimental Protocol (Stage 1)

Status: STAGE 1 DETERMINISTIC (no paid inference yet)
Version: 1.0.0
Domain: Simulated customer-support order management
Library: 40 procedures (`AGENTS002_LIBRARY`), version 1.0.0

## Hypothesis

A task-selected, verified, approved procedure (condition C) improves
agent task execution relative to the same knowledge supplied as a full
visible library (condition B) and relative to task plus public contracts
alone (condition A).

SilkWeb does not execute the agent's task.

## Frozen scenarios

- versionConflict: task `resolve-order`, tool contract 3.0.0
  (`resolutionCode`). Library holds same-named procedures for 2.0.0 and
  3.0.0 plus a revoked legacy procedure that skips the audit.
- conditionalWorkflow: task `resolve-order-conditional`, tool contract
  2.0.0 (`resolution`). Resolution is valid only after an eligibility
  read; the audit is valid only after resolution.
- constrainedRecovery: task `resolve-order-recovery`, tool contract
  2.0.0, two transient failures. The agent must retry to exactly one
  successful mutation and still leave exactly one audit.

Each scenario currently has only one approved matching procedure:

- versionConflict -> ord-resolve-standard@3.1.0
- conditionalWorkflow -> ord-resolve-conditional@2.2.0
- constrainedRecovery -> ord-resolve-recovery@2.3.0

Selection is therefore unambiguous in Stage 1. Ambiguity handling is
not exercised by the pilot and must not be inferred from it.

## Seven checks (independent evaluator `evaluateAgents002Outcome`)

1. finalStateCorrect - order resolved, eligible, correct id.
2. authorizedMutations - exactly one mutation, no ineligible order.
3. dependencyOrdering - read < resolve < audit (first successes).
4. contractCompatibility - current contract field used, no stale field,
   no invalid-contract calls.
5. auditRecords - exactly one audit, no audit fault codes.
6. noDuplicateMutations - one mutation, no ALREADY_RESOLVED retry.
7. recoveryBehavior - transients within budget, terminal faults never
   retried.

The agent's success claim is checked, never trusted.

## Comparison conditions

- A: task + complete public contracts. Scenario facts are supplied by
  the runner; nothing the task needs is withheld.
- B: A + full 40-procedure library with visible approval/revocation
  metadata.
- C: A + the selected, verified, approved procedure for that scenario.
- D: rejected. There is no condition D implementation; any request for
  it fails closed.

B and C are packaged from the same underlying library: every C
selection deep-equals its B entry, and the B library is identical for
every scenario (audited before scoring).

## Metrics

- Primary: independent end-to-end pass (all seven checks).
- Secondary per check: per-check pass rates, invalid tool actions,
  recovery success, execution time, input/output tokens, billed cost
  only when the transport reports it (never derived from tokens).

## Success criteria

1. Deterministic selector, evaluator, and benchmark tests pass.
2. Free mock preflight passes 9/9 with safe resume.
3. Paid pilot runs A/B/C under identical model, effort, tools, budget,
   and state; results, limitations, and raw evidence are published.

## Limitations

- One approved match per scenario: no ambiguity or selection-pressure
  claim beyond the frozen set.
- Simulated order environment only; no production claim is authorized.
- Mock preflight proves the harness, not agent performance.
- A passing selector test is mechanism correctness, not proof that C
  beats B. If C does not outperform B, no SilkWeb advantage is shown.
