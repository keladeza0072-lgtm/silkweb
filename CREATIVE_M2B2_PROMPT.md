You are implementing SilkWeb Creative MVP Milestone 2B-2.

READ:
- CREATIVE_LIBRARY_V1.md
- CREATIVE_M2_CONTRACT.md
- apps/creative-studio/src/provider.ts
- apps/creative-studio/src/concepts.ts
- apps/creative-studio/src/library.ts
- apps/creative-studio/src/recommend.ts
- apps/creative-studio/src/server.ts
- Existing tests

GOAL:
Implement a real Meta Muse Spark 1.3 concept provider,
but keep paid inference disabled by default.

OFFICIAL API:
POST https://api.meta.ai/v1/responses
Model: muse-spark-1.3
Authentication: Authorization: Bearer MODEL_API_KEY
Request uses model and input.
Response contains output message content with output_text.

IMPLEMENT:
1. A MetaMuseConceptProvider using native Node fetch.
2. Server-side MODEL_API_KEY configuration.
3. Explicit opt-in via SILKWEB_CREATIVE_PROVIDER=live.
4. No real API calls unless both settings are present.
5. Exactly one upstream request per generation attempt.
6. No automatic retries.
7. AbortSignal timeout handling.
8. Bounded input and response sizes.
9. Structured concept output instructions.
10. Include approved style and framework instructions.
11. Incorporate context-aware concept recommendations.
12. Return exactly two differentiated concepts.
13. Validate returned concepts through existing orchestrator.
14. Handle API errors, malformed JSON, and missing output.
15. Never log credentials or raw authorization headers.
16. Keep test-provider output separate from live output.
17. Do not persist user campaign descriptions remotely
    unless required by the provider contract.
18. Preserve existing application and tests.

TESTING:
- Inject mock fetch; no live network requests.
- Verify endpoint, model, and authorization structure.
- Verify approved library instructions reach the provider.
- Verify two-concept response parsing.
- Verify failures and timeout handling.
- Verify disabled-by-default behavior.
- Verify zero automatic retries.
- Run existing regression tests.

BOUNDARIES:
- Modify only apps/creative-studio/.
- Do not call live Meta APIs during implementation.
- Do not create credentials or .env files.
- Do not enable the provider automatically.
- Do not generate images.
- Do not redesign the frontend.
- Do not modify SilkWeb benchmarks or MCP.
- Do not commit changes.
- Do not create worktrees.

REPORT:
Files changed, test results, limitations, and
the exact configuration needed for a later
single-request live campaign test.
