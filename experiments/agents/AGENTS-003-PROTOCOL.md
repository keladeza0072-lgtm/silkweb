# AGENTS-003 — Deterministic Execution Protocol (Stage 1)

Status: STAGE 1 DETERMINISTIC (no paid inference yet)
Version: 1.0.0
Domain: Simulated customer-support order management
Library: 40 procedures (`AGENTS002_LIBRARY`), version 1.0.0, reused read-only
Evaluator: `evaluateAgents002Outcome`, version 1.0.0, reused read-only

## Hypothesis

Executing the single task-selected, verified, approved procedure
deterministically matches the AGENTS-002 model baseline pass rate on the
frozen scenarios with zero inference, and controlled model fallback
recovers only the trials where deterministic execution is genuinely
insufficient.

SilkWeb executes only approved procedures. Model output never approves
a procedure and never overrides a compatibility refusal.

## Mechanism (`agents003Executor.mjs`, version 1.0.0)

1. Selection reuses `selectProcedure`: missing approval, revocation,
   incompatible versions, tampered content, and unsupported operations
   fail closed before any environment exists.
2. A static screen refuses multi-mutation or dependency-violating step
   lists (`DUPLICATE_MUTATION_RISK`, `DEPENDENCY_ORDERING_RISK`) with
   zero tool calls.
3. One interpreter pass with the existing bounded transient-retry
   budget. No procedure-level retry, so a successful mutation is never
   re-executed.
4. The real environment outcome is scored by the independent seven-check
   evaluator. The executor's own completion flag is passed as a claim
   and checked, never trusted.
5. Fallback requires genuine insufficiency (no pass) plus explicit
   authorization. Fallback guidance is the already-approved selection,
   or nothing when selection failed. Fallback trials use the same
   evaluator.

## Comparison conditions

- deterministic: approved procedure executed without inference.
- fallback: model acts only when deterministic execution did not pass,
  scored by the same evaluator.
- Baseline: preserved AGENTS-002 A/B/C mock trials, unmodified.

## Success criteria

1. Deterministic unit, integration, and benchmark tests pass.
2. Free preflight passes: 3/3 deterministic, gated fallback probe,
   6/6 checkpoint trials with safe resume, baseline parity.
3. Paid pilot runs only via explicit `--execute` with an isolated
   workspace; results, limitations, and raw evidence are published.

## Limitations

- Same frozen scope as AGENTS-002: one approved match per scenario.
- Simulated order environment only; no production claim is authorized.
- Preflight proves the mechanism, not model performance.
