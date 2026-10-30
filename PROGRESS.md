# Progress

## 2026-10-30, session 1

Done: 16 synthetic documents with gold labels and spans, field and plan schemas, read tools, planner/worker pipeline with plan and handoff validation, single-agent baseline, Python validator with 20 unit tests, TypeScript bridge, review store and CLI, eval with two budgets, fixture demo, `runExtraction` and `npm run extract` for agent-api-sdk, 36 TypeScript tests, docs.

Not done: live run (needs `ANTHROPIC_API_KEY`), a second person running the quick start.

Next: run `make live` and add the live report to evidence/, then try batching several fields per handoff to see whether two-agent can match the baseline's call count.
