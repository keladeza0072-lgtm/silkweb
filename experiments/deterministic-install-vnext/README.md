# Silk Web vNext — deterministic verified-source delivery through MCP

**Status: implemented and CI-tested offline. No Muse coding or paid benchmarks.**

This feature reuses the EXISTING Silk Web source installer. It does not add
another trust authority, modify the six certified sources/manifests/evidence,
or alter the historical INV-BENCH-001 scored candidates.

## Before and after

Old read-only MCP workflow:
1. search_verified_components
2. inspect_verified_component
3. get_verified_component_source (returns thousands of code characters)
4. Muse manually writes/adapts a copy; original certification source SHA may differ.

New operator-approved MCP workflow:
1. search_verified_components
2. inspect_verified_component
3. install_verified_component with exact id/version (dryRun optional)
4. Tool verifies manifest and actual executed certification evidence, resolves
   the full component dependency closure, and uses the existing fail-closed
   installer to copy sources **byte-for-byte** under \`src/silkweb/\`.
5. Model receives SHORT metadata including destination, each file SHA-256, the
   installation audit path, the component fingerprint and import guidance.
6. Muse writes only its own integration code; it must compile and test the app.

Original source retrieval tool remains available when needed. The new writing
tool is NOT advertised unless the operator enables it.

## Operator setup: isolate a single project

Run the registry build and MCP build in this feature-branch checkout. The
operator sets these extra MCP env entries in the Muse tool configuration:

\`\`\`json
{
  "SILKWEB_REPO_ROOT": "C:\\Users\\...\\Projects\\silkweb-vnext",
  "SILKWEB_ALLOW_INSTALL": "1",
  "SILKWEB_TARGET_WORKSPACE": "C:\\Users\\...\\Projects\\my-agent-app",
  "SILKWEB_AUDIT_LOG": "C:\\Users\\...\\Projects\\my-run\\operator\\mcp-audit.jsonl"
}
\`\`\`

**Those example paths are placeholders**, not commands. Configure each
installation to one pre-created, separate application project OUTSIDE the
entire Silk Web source checkout. It must contain \`package.json\` with
\`"type":"module"\`, \`tsconfig.json\`, and any exact runtime package versions
required by the certified component.

No other target directory may be passed in the tool arguments. The target
workspace is bound by the MCP server environment before the agent begins.
Do not opt in on an untrusted target or one containing files you cannot
afford to edit.

## Tool input

\`\`\`json
{"id":"inventory-reservation","version":"0.1.0","dryRun":true}
\`\`\`

\`dryRun:true\` previews all planned files without writing sources or
installation audit; \`dryRun:false\` (the default) performs the exclusive
file creation. Inputs do NOT accept project-root, command, shell, arbitrary
destinations or a source snippet.

Successful output includes:
- \`status\`: \`dry-run\` or \`installed-source\`
- \`component\`, \`files[]\` with \`path\`, \`bytes\`, \`sha256\`, \`action\`
- \`registryFingerprint\`, \`certifiedSourceHash\`
- \`auditReportPath\`, \`assurance\`, \`integrationGuidance\`

Each real installation writes \`.silkweb/installations/<id>@<version>.json\`
in the target workspace and records an independent, no-source-text MCP
audit event if \`SILKWEB_AUDIT_LOG\` is configured.

## Security / integrity boundaries

- Default: the original four **read-only** MCP tools; installer absent.
- Enable explicitly with \`SILKWEB_ALLOW_INSTALL=1\`.
- Explicit \`SILKWEB_TARGET_WORKSPACE\` points to ONE existing real directory,
  not a symlink or its traversed parent; **no** model-supplied project path.
- Entire Silk Web source checkout is protected against installation writes.
- Exact certified id/version; all dependencies and actual certification
  evidence must validate. Stale/forged/unverified code fails closed.
- Deterministic paths \`src/silkweb\` and \`.silkweb/installations\`;
  modified existing files, symlinks and other collisions are rejected.
- Exclusive new file writes, rollback on partial failure, independent
  post-install SHA-256 check. No shell, npm scripts, paid inference,
  background services or code execution from a component manifest.
- Source files and audit records contain no hidden test/benchmark data;
  installed source is *not* executable permission or proof of application
  correctness by itself.
- Source integrity: full original bytes (not only comment-insensitive
  equivalence). No target build or behavioral claims until tested.
- Local filesystem race attacks by hostile concurrent processes are not
  fully solved by portable JavaScript APIs; do not run against actively
  adversarial or concurrently mutated workspaces.

## Repeatable evidence

Feature branch workflow:
\`.github/workflows/deterministic-mcp-install-vnext.yml\`

It checks:
- 80 certified registry tests and six unmodified Windows-origin certificates
  validating on Linux;
- 18 original installer + application integration tests;
- 37 MCP tests, including default-off behavior, dry run, exact bytes,
  repeat idempotence, collision, protected-root and symlink rejection.

**Future benchmark** must use fresh B/C candidates and a frozen same task.
B has no MCP; C has the certified MCP plus opt-in installer bound to C.
The previous INV-BENCH-001 (95/100 vs 100/100, C slower/costlier) remains
historical, not a result of the new installer. The primary hypothesis is
lower Muse output tokens and coding time through metadata-only delivery;
neither is established yet.
