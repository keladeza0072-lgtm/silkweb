# RES-001 starter (identical B/C base)

This starter contains no reservation logic. The external functional contract
is in `../RES-001.md` in the development repository and is given verbatim to
the coding agent. There are no evaluator tests in this starter.

Setup ONCE in a temporary staging directory (not an agent workspace):
`npm.cmd install --package-lock-only --ignore-scripts`, then copy its
`package-lock.json` to both condition workspaces. For each condition,
`npm.cmd ci` before launch and freeze the identical starter hashes.

The evaluator, Silk Web repository, registry source, and local MCP server
must not be copied into the agent workspaces. Condition C receives MCP
tool access; condition B does not. Both receive the same task text.
