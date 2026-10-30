# review-workflow

A planner agent and a worker agent extract nine fields from invoice-like documents. Every value comes with a quote that must be an exact substring of the document; a value that is missing, illegible or ambiguous comes back as `null` with a reason, never as a guess. A small Python component checks types, required fields, `net + vat = total` and `due_date >= invoice_date`. A human then corrects, approves and exports a local draft, and the corrections are stored next to the model's original proposal, not over it. The same documents also run through a single-agent baseline under the same budget, and the report says which one did better.

## Quick start

Node 22 or later, Python 3.10 or later on `PATH` (standard library only).

```bash
make install     # npm ci, pinned versions
make demo        # seven fixture scenarios, scripted models, no API key, no cost
make test        # 20 Python tests + 36 TypeScript tests
make eval        # baseline vs planner/worker on 16 labelled documents, report in evidence/
make check       # typecheck + tests + demo
```

Use another interpreter with `make test PYTHON=python3.10`. Live run against a real model (costs money, needs a key):

```bash
export ANTHROPIC_API_KEY=...
make live        # both architectures on five documents
```

## What the demo shows

Excerpt from `make demo` (full log in `evidence/demo-fixture-*.jsonl`):

```
> 1. complete document, planner/worker: INV-001
  plan accepted: 9 x extract_field, then check_totals, check_dates, flag_missing
  handoffs: 9 sent, 9 accepted, 0 rejected
  invoice_date    "2026-09-14"                 quote: "2026-09-14"
  net             6910                         quote: "6 910,00"
  total           8637.5                       quote: "8 637,50"
  findings: none   model calls: 19   tool calls: 9   status: completed

> 2. missing and ambiguous values stay null, each with a reason
  INV-006
  invoice_date    null      reason: invoice_date 03/04/2026 is ambiguous: day and month could be either way round
  INV-010
  currency        null      reason: only "kr" is written, which can mean SEK, NOK or DKK

> 3. the Python validator flags documents that are wrong on paper
  INV-005 TOTAL_MISMATCH: net 6950 + vat 1737.5 = 8687.5, but total is 8867.5 (difference -180.0, tolerance 0.01)

> 4. invalid plans are rejected and logged; the planner's third plan is accepted
  REJECTED plan: tasks.0: check_totals needs net, vat, total extracted earlier in the plan | tasks.1: flag_missing must be the last task

> 5. invalid handoffs are rejected and logged
  REJECTED worker return: total: quote "8867.5" is not an exact substring of the document
  REJECTED guess (invoice date + 30 days = 2026-09-28): due_date: quote "due_date: 2026-09-28" is not an exact substring of the document
  retry accepted: due_date = null, reason: no due_date found in the document

> 6. human review of INV-016 (held-out document the fixture rules partly miss)
  correction #1 2026-10-30T05:14:59.677Z  invoice_number: null (model) -> "7731"
  approved 2026-10-30T05:14:59.778Z after 2 corrections
  export refused: INV-016 has 1 correction(s) made after the last approval; approve again
  re-approved and exported local draft: 3 corrections, proposal.json untouched (net there is still null)

> 7. single-agent baseline vs planner/worker, same 16 documents, same budgets (fixture models only)
| budget   | architecture | field accuracy  | guessed | not extracted | model calls (per doc) |
| standard | single-agent | 94.4% (136/144) | 0       | 0             | 48 (3.0)              |
| standard | two-agent    | 94.4% (136/144) | 0       | 0             | 304 (19.0)            |
| tight    | single-agent | 94.4% (136/144) | 0       | 0             | 48 (3.0)              |
| tight    | two-agent    | 52.1% (75/144)  | 0       | 64            | 192 (12.0)            |
```

(Table columns trimmed here; the demo and `evidence/eval-fixture-*.md` print all of them. Timestamps differ per run.)

**Read the comparison honestly.** In fixture mode both architectures use the same scripted reading rules, so equal accuracy at the standard budget is expected by construction. What the fixtures do show is orchestration cost: the planner/worker version needs about six times the model calls, and with the same tight budget of 12 calls per document it runs out and leaves fields unextracted, so it is clearly **worse** than the baseline there. Whether a second agent improves extraction quality with a real model is not shown until `make live` has been run.

## How it works

```
document text
   |
   +--> two-agent ---------------------------------------------------------------+
   |    planner (submit_plan)                                                    |
   |      plan schema: extract_field{field} | check_totals | check_dates | flag_missing
   |      + ordering rules (checks after the fields they need, flag_missing last)
   |      invalid -> plan_rejected, error back to planner (max 3 attempts)
   |    for each task:
   |      handoff {handoff_id, task_index, doc_id, task}  -> checkHandoff vs accepted plan
   |      extract_field -> worker agent (search_text, read_lines, get_document_info)
   |                       submit_field -> checkField: right field, typed value,
   |                       exact quote, or null + reason      else handoff_rejected, retry
   |      check_*       -> Python validator, that check only
   |                                                                             |
   +--> single-agent: one agent, same read tools, submit_extraction (all fields) |
   |                                                                             |
   v                                                                             v
 validator/validate.py  (child_process, JSON on stdin, findings JSON on stdout)
   types, required keys, null reasons, quotes, net+vat=total, due >= invoice, missing
   |
   v
 ExtractionResult {fields, findings, calls, tool_calls, usage, cost_usd, mode}
   |
   v
 review store: proposal.json (written once) | corrections.jsonl (append) | approvals.jsonl
   approve: error findings must be fixed or acknowledged by code
   export:  only if the last approval saw every correction -> exports/<doc>.draft.json
```

Both architectures share one per-document budget (`maxModelCalls`, `maxToolCalls`). A field the pipeline never reached is `null` with reason `not extracted: ...`, and the eval scores it as wrong.

| File | Role |
| --- | --- |
| `src/schema.ts` | Field schema, `checkField` (the no-guess gate), plan and handoff schemas, `validatePlan`. |
| `src/pipeline.ts` | Two-agent orchestration, `checkHandoff`, single-agent baseline. |
| `src/loop.ts` | One agent's tool loop: budget, read tools through the registry, final tool validated and rejected back to the model. |
| `src/agents/` | System prompts and the three final tools (`submit_plan`, `submit_field`, `submit_extraction`). |
| `src/tools/readTools.ts` | `get_document_info`, `read_lines`, `search_text`. Read only. |
| `src/validator.ts` | Spawns the Python validator, fails loudly if Python is missing. |
| `validator/validate.py` | Deterministic checks, stdlib only. Tests in `validator/test_validate.py`. |
| `src/review/store.ts` | Proposal, corrections and approvals as separate files; approve and export rules. |
| `src/evaluate.ts` | Scoring against gold labels, comparison tables. |
| `src/model/` | Provider-neutral transcript, scripted fixture models, the fixture reading rules, Anthropic adapter. |
| `src/cli/` | `demo`, `eval`, `extract`, `review`, `live`. |
| `data/` | 16 synthetic documents and `gold.json`. See [data/README.md](data/README.md). |

## Reuse from agent-api-sdk

Function:

```ts
import { runExtraction, toPublicJson } from "review-workflow"; // or "./src/index.ts"

const result = await runExtraction(docText, {
  architecture: "two-agent",          // or "single-agent"
  mode: "fixture",                    // or "live" (needs ANTHROPIC_API_KEY)
  docId: "INV-001",
  budget: { maxModelCalls: 30, maxToolCalls: 40 },
});
```

CLI (prints exactly one JSON object on stdout; errors go to stderr, exit 2 when live mode has no key):

```bash
npm run --silent extract -- --json data/docs/INV-003.txt [--arch single-agent] [--live]
```

```json
{
  "fields": {
    "total":    { "value": 18675, "quote": "18 675,00", "confidence": 0.9 },
    "due_date": { "value": null,  "quote": null, "reason": "no due_date found in the document" }
  },
  "findings": [{ "code": "MISSING_VALUE", "severity": "warning", "field": "due_date", "message": "...", "source": "validator" }],
  "calls": 19,
  "tool_calls": 9,
  "mode": "fixture",
  "architecture": "two-agent",
  "status": "completed",
  "usage": null,
  "cost_usd": null
}
```

`fields` always has all nine keys. `calls` is the number of model calls. `usage` is `null` in fixture mode. `cost_usd` is `null` unless `PRICE_INPUT_PER_MTOK` and `PRICE_OUTPUT_PER_MTOK` are set. The review store is exported too (`ReviewStore`), and the review CLI is `npm run review -- propose|show|correct|approve|export` (usage in `src/cli/review.ts`).

## What this proves and what it does not

- Fixture runs prove the guards: plans outside the schema are stopped, handoffs that do not match the plan are stopped, quotes that are not in the document are refused, missing values cannot be filled in without a quote, corrections never overwrite the proposal, and an export needs a current approval. They prove nothing about how well a real model extracts fields or plans. That needs `make live`; its status is in [ACCEPTANCE.md](ACCEPTANCE.md).
- The fixture accuracy figures measure hand-written reading rules (`src/model/heuristics.ts`). Fourteen documents were written alongside those rules; the two held-out documents show what the rules miss (8 of 18 fields, all as honest nulls).
- An exact quote proves the text exists in the document. It does not prove the quote supports the value (a date quote could be the wrong date). The `invoice_number` and `org_number` values must also appear inside their quote; other fields are not checked that way.
- The review step is a local CLI. The web review experience is agent-api-sdk. Nothing is booked, sent or filed.
- No cost figure is reported: fixture runs cost nothing, and live cost is computed only from prices you pass in.
- All data is synthetic. See [data/README.md](data/README.md).

Design trade-offs are in [DECISIONS.md](DECISIONS.md).

Built with AI assistance (Claude); every change is reviewed and run locally.
