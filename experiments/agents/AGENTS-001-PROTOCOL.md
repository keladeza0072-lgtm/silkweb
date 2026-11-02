# AGENTS-001 — Frozen Experimental Protocol

Status: DESIGN LOCK CANDIDATE
Version: 1.0.0
Domain: Simulated customer-support order management

## Hypothesis

A task-selected, verified procedural-intelligence package
improves existing-agent task execution relative to equivalent
procedural information supplied as ordinary documentation.

SilkWeb does not execute the agent's task.

## Conditions

A — Baseline:
Identical clarified task, tool interfaces, and initial state.
No procedural registry or supplemental playbooks.

B — Documentation:
Everything in A, plus the complete procedural documentation
available to the experiment.

C — SilkWeb:
Everything in A, plus task-selected, version-compatible,
verified procedural intelligence supplied through SilkWeb.

The underlying agent model, reasoning effort, tool access,
step budget, and initial state must be identical.

## Scenarios

S1 — Routine resolution:
An agent must update an eligible order and leave an
auditable resolution record.

S2 — Changed tool contract:
A previously valid procedure becomes incompatible with
the currently declared tool version.
The system must reject stale guidance.
The agent must obey the current contract.

S3 — Transient failure:
An order-management tool fails temporarily.
The agent must recover safely without duplicate mutations.

## Primary metric

Independent end-to-end task-state success.

Success requires:
- Correct final order state.
- Required audit record.
- No prohibited mutation.
- No duplicate state-changing operation.

## Secondary metrics

- Invalid tool actions.
- Recovery success.
- Stale-procedure exposure.
- Agent execution time.
- Input and output tokens.
- Actual billed inference cost, if available.

## Evaluation controls

- Freeze scenario specifications before paid inference.
- Keep evaluator assertions inaccessible to the agent.
- Preserve equivalent task and tool access across conditions.
- Do not manually repair agent outputs during scored runs.
- Record every attempt and intervention.
- Record model build, settings, runtime, and tool versions.
- Report individual results, not invented averages.
- Use the same evaluation method for A, B, and C.
- Distinguish deterministic selector tests from agent benchmarks.
- Do not infer cost savings from token counts alone.

## Registry trust requirements

Every procedure must identify:
- Procedure ID and version.
- Applicable task category.
- Compatible tool contract version.
- Steps and safety constraints.
- Recovery guidance, where applicable.
- Provenance.
- Verification status and supporting evidence.

Selection must fail closed for:
- Unverified procedures.
- Incompatible tool versions.
- Revoked procedures.
- Missing required evidence.
- Ambiguous incompatible candidates.

Verification status must not be fabricated.

## Acceptance gates

Gate 1:
Local deterministic selector tests pass.

Gate 2:
Independent simulated-state evaluator passes its own
positive and negative tests.

Gate 3:
The existing agent is connected without changing its
task-execution responsibilities.

Gate 4:
A/B/C runs are completed under equivalent conditions.

Gate 5:
Results, limitations, and raw evidence are published.

## Interpretation

A passing selector test establishes mechanism correctness,
not agent performance improvement.

If C does not outperform B on meaningful measures, the
experiment does not establish SilkWeb's unique advantage.

No production or performance claim is authorized solely
by this protocol.
