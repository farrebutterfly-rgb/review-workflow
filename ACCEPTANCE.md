# Acceptance

Checked 2026-10-30 on Node 22.23.4 and Python 3.13.18 (validator tests also run on Python 3.10.x), Linux x64. Fixture runs only. "Not run" means not run, not passed.

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Results follow the schema and missing values are not filled with guesses | Passed (fixture) | tests `every document, both architectures: output follows the schema...`, `missing and ambiguous values are null with a reason, never guessed`, `a guessed value with an invented quote is refused`; eval column *guessed* = 0 for every run |
| 2 | Invalid plans and handoffs are stopped | Passed | tests `plans outside the bounded schema are rejected`, `plan ordering rules`, `handoffs that do not match the accepted plan are rejected`, `a planner that never produces a valid plan...`, `a worker return with a paraphrased quote...`, `a worker answering for the wrong field...`; demo sections 4 and 5; `plan_rejected` and `handoff_rejected` events in `evidence/demo-fixture-2026-10-30.jsonl` |
| 3 | Human corrections are stored separately from the model's original proposal | Passed | tests in `test/review.test.ts`; demo section 6; `review_correction` and `review_export` events (the export holds both `model_proposal` and `corrections`) |
| 4 | At least ten labelled examples run with both architectures on the same input and budget limits | Fixture: passed, 16 documents x 2 architectures x 2 budgets. Live: **Not run** (no API key in the build environment) | test `comparison runs both architectures on the same documents with the same budgets`; `evidence/eval-fixture-2026-10-30.jsonl` |
| 5 | The report compares quality, number of calls and measured cost when available; a worse two-agent result is reported too | Fixture: passed. Quality and calls compared; two-agent is worse at the tight budget and the report says so. Cost: n/a in fixture mode (no API calls). Live: **Not run** | `evidence/eval-fixture-2026-10-30.md`; test asserts the tight-budget result is worse and present |
| Show | Complete document, missing field, a correction in the review step | Passed | `make demo` sections 1, 2 and 6 |

Extra checks beyond the plan: Python validator unit tests (20, also on Python 3.10), quote exactness on every field of every document, verbatim check for `invoice_number` and `org_number`, budget exhaustion scored as wrong, approval blocked by error findings unless acknowledged, export refused after a later correction, clear errors for missing Python and missing API key.

## Open gaps

- No live model run. The comparison says nothing yet about real extraction quality or real cost.
- Fixture reading rules were written alongside 14 of the 16 documents; only the two held-out documents test them on unseen layouts.
- An exact quote does not prove the quote supports the value for dates and amounts.
- Not yet tried by a second person from a clean machine (only a clean `npm ci` here).
