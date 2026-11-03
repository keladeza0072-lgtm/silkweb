# SilkWeb — Reusable Intelligence Infrastructure

**SilkWeb** explores how AI applications can reuse verified knowledge, task-relevant context, and procedures instead of repeatedly solving the same problems from scratch. The goal is to reduce redundant model work while preserving output quality.

**Live demo:** https://silkweb-creative.onrender.com

## What it demonstrates

| Area | Demonstration |
| --- | --- |
| **Creative** | A user supplies a product image or name and a campaign objective to generate three distinct image ads with accompanying copy. Live model generation is access-controlled. |
| **Code** | A Git-backed knowledge registry and MCP tools expose verified development knowledge to a coding agent. |
| **Data** | Task-relevant data contracts are selected instead of sending an entire documentation set. |
| **Agents** | Reusable, verified procedures and a deterministic execution/evaluation layer demonstrate agent knowledge reuse. |

Explore the corresponding sections of the [live website](https://silkweb-creative.onrender.com), including its **Evidence** and **Research** pages.

## Why this matters

Models are increasingly capable, but applications can still waste time and tokens rediscovering solutions or consuming irrelevant context. SilkWeb investigates a complementary optimization: provide the right verified knowledge at the right point in a workflow. It is infrastructure around the model, not a claim that the underlying model itself has become more intelligent.

## Measured results

The results below are **workload-specific experiments**, not general guarantees or production SLAs.

| Experiment | Comparison | Observed result |
| --- | --- | --- |
| **Code — RES-002** | One paired coding-agent trial, without vs. with SilkWeb | Evaluation quality **98.5/100 → 100/100**; coding time **−15.20%**; total input tokens **−3.53%**; uncached input tokens **−56.28%**; output tokens **−29.84%**. |
| **Data — REV-004** | Five SQLite questions: no docs, full docs, selected contract | Correct answers **2/5**, **5/5**, and **5/5**, respectively. Selected contract vs. full docs: time **−27.85%**; output tokens **−6.54%**. |
| **Agents — AGENTS-002** | Nine coding-agent trials | Time **−16.43%**; total input tokens **−20.77%**; uncached input tokens **−76.58%**; output tokens **−48.51%**. |
| **Agents — AGENTS-003** | Deterministic local execution test, not a model benchmark | **90/90** successful local executions, **zero model calls**, ~**2.01 ms** mean execution. Not directly comparable to model-driven coding trials. |

**Cost caveat:** Inference-cost reductions were **not independently established** in RES-002; token savings should not be presented as verified dollar savings. Results from the small Data fixture require broader validation.

## Meta technology

SilkWeb's experiments used **Muse Spark 1.3** for coding-agent evaluation. SilkWeb Creative integrates Meta model-powered creative planning and image generation through a live provider workflow. The broader system includes a Git-backed registry, task-relevant context selection, and Model Context Protocol (MCP) interfaces.

## Repository map

- `apps/creative-studio/` — web application, creative workflows, frontend and backend.
- `apps/mcp-server/` — local MCP server and knowledge access tools.
- `packages/` — reusable infrastructure and agent components.
- `experiments/` — benchmark protocols and related experimental artifacts.
- `docs/` — supporting documentation.

This is a hackathon research prototype with several experimental components. The live Creative workflow requires server-side model credentials and a **private demo access code**. Do not commit credentials or publish judge access codes.

## Run the Creative application locally

Requires Node.js and npm. From the repository root:

```sh
cd apps/creative-studio
npm ci
npm run build
npm test
npm start
```

Open `http://localhost:3003` unless a different `PORT` is configured. Live model generation requires provider configuration and credentials; without those, do not interpret offline draft outputs as live AI-generated ads. See `apps/creative-studio/` for implementation details.

## Security and limitations

- Never commit `.env` files, API keys, or private demo access codes.
- Live generation has access checks and a per-process accepted-job limit; process restarts can reset that limit. It is **not** a durable financial spending cap.
- Benchmark improvements reflect the stated tasks and trials, not all model workloads.
- Publicly accessible pages and deterministic tests do not imply unrestricted live inference access.

## Project status

Hackathon MVP. The website, benchmark evidence, and research pages showcase the implemented capabilities; further validation, production-grade persistence, and broader workload testing remain future work.
