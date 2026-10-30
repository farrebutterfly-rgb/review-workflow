# Decisions

**The quote gate is the anti-guessing rule.** A non-null value is accepted only with a quote that is an exact substring of the document; a null is accepted only with a reason and no quote. The check (`checkField`) runs on every worker return, on the baseline's submission, again in Python, and on human corrections that carry a quote. A model that invents a value has to invent a quote too, and that is caught. It does not prove that the quote supports the value; for `invoice_number` and `org_number` the value must also appear inside the quote.

**Ambiguity is a null, not a coin toss.** `03/04/2026` with nothing deciding day or month, `kr` without a country, and payment terms instead of a due date are all `null` with a reason in the gold labels, and the pipeline is scored against that. A reviewer can still fill them in.

**Bounded plan, checked twice.** The plan is a zod discriminated union of four task types plus ordering rules a schema cannot express (checks after the fields they need, `flag_missing` last, no duplicates, right `doc_id`). Rejected plans go back to the planner as errors, up to three attempts. Handoffs are rebuilt from the accepted plan and checked against it again before a worker sees them, so a corrupted or injected handoff is logged and dropped.

**One worker call per field.** The worker gets one field per handoff. That keeps each handoff small and easy to verify, and makes the cost visible: about 19 model calls per document against 3 for the baseline. It is the reason two-agent loses under a tight budget. Batching fields per handoff would cut calls and is the obvious next experiment.

**Same budget, shared by both agents.** Planner and worker draw from one per-document budget; the baseline gets the same numbers. When it runs out, the remaining fields are `null` with `not extracted: ...` and the eval scores them as wrong, so running out cannot pass as a correct abstention.

**Checks are deterministic and in Python.** `validate.py` is stdlib only, reads JSON on stdin and prints JSON, so it can be called from any language and tested on its own. The plan's check tasks run the matching check at that point in the plan; both architectures end up with the same set of checks.

**Fixture models share one set of reading rules.** Both scripted architectures call the same `readField` on the same lines (the worker's search terms are the rules' own terms), so in fixture mode accuracy differences can only come from orchestration. This keeps the fixture comparison from being rigged in either direction, and the report says what it measures. Two documents were written after the rules were frozen to show their real limits.

**Review state is append-only files, not a database.** `proposal.json` is written once with `wx`, corrections and approvals are JSONL appends, and the draft is computed. Anyone can read the history with `cat`. An approval records how many corrections it saw; export refuses if more were made afterwards. Error findings block approval unless the reviewer acknowledges the code (some paper invoices really are wrong).

**No price table.** Cost is computed only from `PRICE_INPUT_PER_MTOK` and `PRICE_OUTPUT_PER_MTOK` given at run time, so the repo never prints a cost nobody checked. Token counts come from the API response.

**CLI review instead of a web page.** A simple local view is enough here; the full React flow lives in agent-api-sdk. A CLI is easier to test and leaves the UI decisions to agent-api-sdk, which reuses `runExtraction` and `ReviewStore`.

**Reused from agent-toolkit after reading it:** the tool registry (validation, timeout, error shape), the provider-neutral transcript, the scripted model and the Anthropic adapter, copied rather than linked so this repo runs on its own.

**Not done on purpose.** No OCR or PDF parsing (documents are text). No retries beyond returning a rejection to the same agent. No parallel workers. No React.
