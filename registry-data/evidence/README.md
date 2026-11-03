# registry-data/evidence

Machine-readable verification evidence records, one per verified component
version: `<id>-<version>.json`.

This directory is intentionally EMPTY right now: all four Day-2 manifests
are `unverified`, and the goal of the current slice is the verifier itself,
not certifying components. No evidence file is fabricated to upgrade a
manifest — a record appears here only when the local verification runner
(`packages/registry/src/runner.ts`) actually executes an allowlisted test
command and observes a successful process exit.

Each record follows `evidenceSchema` (`packages/registry/src/evidence.ts`,
schema version 1) and binds a component id/version to the SHA-256 artifact
fingerprint recomputed from the checkout at run time, the exact command
that ran, its exit code and outcome, the Node/SQLite runtime versions, and
an execution timestamp.

Consumers must never trust `verification.status = "verified"` on its own:
use `selectVerifiedManifests` (`packages/registry/src/validate.ts`), which
recomputes fingerprints from current repository files and rejects or
downgrades unsubstantiated claims with an explicit reason.

See `packages/registry/README.md` ("Verification") for how a human
reproduces verification.
