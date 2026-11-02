# AGENTS-001 Paid Pilot

Preflight (free, mock transport):

```powershell
node experiments/agents/run-agents001-preflight.mjs
```

First REAL paid 3x3 pilot (run from the repository root):

```powershell
node experiments/agents/run-agents001-pilot.mjs --workspace C:\agent-work\muse-isolated --checkpoint experiments/agents/checkpoints/agents001-pilot.jsonl --execute
```

Resume after interruption with the identical command. Completed trials are
skipped via the checkpoint. Cost is recorded only when the transport
reports it; token counts are never converted into money.
