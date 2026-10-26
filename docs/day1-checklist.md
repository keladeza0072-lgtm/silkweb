# Day 1 evidence record — 26 October 2026

Handoff first gate: Muse Code invokes local Silk Web `ping` and receives
`{"ok":true,"service":"silkweb"}` as validated JSON.

| Check | Status on template creation | Evidence to capture |
|---|---|---|
| Node, npm, Git, Muse installed locally | Not checked | version outputs |
| Muse auth / Spark 1.3 entitlement | Not checked | non-secret account status |
| Standard mode / credits / billing / spending controls | Not checked | non-secret dashboard notes |
| npm install + lockfile | Not checked | npm success and lockfile |
| TypeScript compilation | Not checked | npm run build output |
| Local MCP stdio smoke test | Not checked | npm run smoke output |
| MCP registration in Muse /mcp | Not checked | screenshot / output |
| Actual Muse invocation of ping | Not checked | tool event and JSON response |
| Private GitHub remote and pushed commit | Not checked | Git SHA and private remote status |

**Do not rewrite a failing observation as a pass.** Keep actual outputs,
date/time, and a short note on any human intervention.

## Evidence filename recommendation
`docs/evidence/day1-<local-date>-ping.txt` (redact all secrets). Include:
Node/npm/Git/Muse versions; repo commit SHA; smoke test result; /mcp inventory;
Muse's actual ping tool event and response; model choice + contributor off;
billing mode/credits confirmation; model usage cost if a model call occurred.
