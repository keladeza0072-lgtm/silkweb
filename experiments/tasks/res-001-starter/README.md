# RES-001 starter (identical B/C base)

This starter contains no reservation logic. The external functional contract
is in `../RES-001.md` in the development repository and is given verbatim to
the coding agent. There are no evaluator tests in this starter.

The exact dependency tree is already pinned in `package-lock.json`
using the same Zod, TypeScript and Node type versions as Silk Web's tested
registry. Do NOT regenerate the lockfile independently for either condition.

Create fresh independent workspaces using identical byte-for-byte copies of
this starter, then run `npm.cmd ci` in each before Muse launch. Record the
starter commit/hash and freeze identical dependencies. Neither workspace
receives a registry source checkout or held-out evaluator.

The evaluator, Silk Web repository, registry source, and local MCP server
must not be copied into the agent workspaces. Condition C receives MCP
tool access; condition B does not. Both receive the same task text.
