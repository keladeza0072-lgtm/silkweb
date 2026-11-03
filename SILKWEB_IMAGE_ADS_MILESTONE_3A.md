# SilkWeb Image Ads — Milestone 3A

Advertising intelligence integrated into the three-ad Muse Spark planning pipeline.
Customer contract unchanged: one product image or name plus one campaign objective,
exactly three ads (cold/discovery, warm/consideration, hot/action), each with
headline, body, CTA, and visual prompt.

## New sources

- `apps/creative-studio/src/knowledgePack.ts` — versioned pack
  (`m3a-v1`): 8 live-cleared editorial paraphrases (Schwartz, Ogilvy,
  Sugarman, Cialdini) plus 2 pending entries stored but excluded from
  planning. No quotations, page references, or source-verification claims.
- `apps/creative-studio/src/imageAdStrategy.ts` — deterministic,
  evidence-gated per-audience retrieval over the six approved styles,
  four approved frameworks, and live pack principles.

## Evidence gates

Offers need a user-supplied offer; before/after and BAB need concrete
transformation evidence (bare "better"/"faster" never qualifies); FAB
needs supplied product facts. Rejected candidates are recorded in
provenance with reasons. Existing policy checks are untouched.

## Provenance

`buildImageAdPlanPromptWithProvenance()` returns the prompt plus an
internal record (pack version, style/framework/principle ids, reasons,
rejections), also kept in a capped in-memory log. Never in the customer
payload or UI. No quality-improvement claims are made.

## Boundaries respected

No UI/API change, no registry/benchmark/evidence changes, no live Meta
calls, no paid generation, no retries, no typography/SAM 3.1/stock work.
Prompt stays within the existing 8000-char budget; safety lines are never
truncated. Typography and compositing remain Milestone 3B work.
