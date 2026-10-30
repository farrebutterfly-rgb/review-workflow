import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUDGETS, loadDoc, loadGold, runEval, summaryTable } from "../evaluate.ts";
import { runExtraction } from "../extract.ts";
import { RunLog } from "../log.ts";
import { plannerWithBadFirstPlan, scriptedWorker, workerGuessesFirst, workerParaphrasesFirst, FULL_PLAN } from "../model/fixtures.ts";
import { checkHandoff } from "../pipeline.ts";
import { ReviewError, ReviewStore } from "../review/store.ts";
import { FIELD_NAMES, type ExtractionResult } from "../schema.ts";
import { codeRev, sessionRecord, stamp, startEvidence } from "./common.ts";

const file = `evidence/demo-fixture-${stamp()}.jsonl`;
const session = sessionRecord("fixture", "invoices-v1", { model: "scripted fixture models", budgets: BUDGETS });
startEvidence(file, session);
const log = new RunLog(file);
const gold = loadGold();
const doc = (id: string) => loadDoc(gold.documents.find((d) => d.doc_id === id)!);
const since = () => log.events.length;
const eventsFrom = (i: number, ...types: string[]) => log.events.slice(i).filter((e) => types.includes(e.type));
const short = (v: unknown) => (typeof v === "string" ? JSON.stringify(v) : String(v));

function printFields(r: ExtractionResult, only?: string[]) {
  for (const f of FIELD_NAMES.filter((x) => !only || only.includes(x))) {
    const x = r.fields[f];
    console.log(x.value === null ? `  ${f.padEnd(15)} null      reason: ${x.reason}` : `  ${f.padEnd(15)} ${short(x.value).padEnd(28)} quote: ${JSON.stringify(x.quote)}`);
  }
}
const codes = (r: ExtractionResult, sev?: string) => r.findings.filter((f) => !sev || f.severity === sev).map((f) => f.code + (f.field ? `(${f.field})` : ""));

console.log(`review-workflow fixture demo  (scripted models, no API calls, no cost)  rev=${codeRev()}  dataset=invoices-v1\n`);

// 1 ------------------------------------------------------------------------------------------
console.log("> 1. complete document, planner/worker: INV-001");
let i = since();
let r = await runExtraction(doc("INV-001"), { docId: "INV-001", log });
const plan = eventsFrom(i, "plan_accepted")[0]?.tasks as { type: string }[];
console.log(`  plan accepted: ${plan.filter((t) => t.type === "extract_field").length} x extract_field, then ${plan.filter((t) => t.type !== "extract_field").map((t) => t.type).join(", ")}`);
console.log(`  handoffs: ${eventsFrom(i, "handoff").length} sent, ${eventsFrom(i, "handoff_accepted").length} accepted, ${eventsFrom(i, "handoff_rejected").length} rejected`);
printFields(r);
console.log(`  findings: ${codes(r).join(", ") || "none"}   model calls: ${r.calls}   tool calls: ${r.tool_calls}   status: ${r.status}\n`);

// 2 ------------------------------------------------------------------------------------------
console.log("> 2. missing and ambiguous values stay null, each with a reason");
for (const [id, fields] of [["INV-003", ["due_date"]], ["INV-006", ["invoice_date", "due_date"]], ["INV-010", ["currency"]], ["INV-009", ["invoice_number"]]] as const) {
  r = await runExtraction(doc(id), { docId: id, log });
  console.log(`  ${id}`);
  printFields(r, [...fields]);
}
r = await runExtraction(doc("INV-014"), { docId: "INV-014", log });
console.log(`  INV-014 (illegible scan): ${FIELD_NAMES.filter((f) => r.fields[f].value === null).length} of 9 fields null, all with reasons; warnings: ${codes(r, "warning").length} x MISSING_VALUE\n`);

// 3 ------------------------------------------------------------------------------------------
console.log("> 3. the Python validator flags documents that are wrong on paper");
for (const id of ["INV-005", "INV-007"]) {
  r = await runExtraction(doc(id), { docId: id, log });
  for (const f of r.findings.filter((x) => x.severity === "error")) console.log(`  ${id} ${f.code}: ${f.message}`);
}
console.log("");

// 4 ------------------------------------------------------------------------------------------
console.log("> 4. invalid plans are rejected and logged; the planner's third plan is accepted");
i = since();
r = await runExtraction(doc("INV-001"), { docId: "INV-001", log, models: { planner: plannerWithBadFirstPlan } });
for (const e of eventsFrom(i, "plan_rejected")) console.log(`  REJECTED plan: ${(e.problems as string[]).join(" | ")}`);
console.log(`  then plan_accepted, status ${r.status}, ${r.rejections.plans} rejected plan(s)\n`);

// 5 ------------------------------------------------------------------------------------------
console.log("> 5. invalid handoffs are rejected and logged");
i = since();
r = await runExtraction(doc("INV-005"), { docId: "INV-005", log, models: { worker: (h) => (h.task.type === "extract_field" && h.task.field === "total" ? workerParaphrasesFirst(h) : scriptedWorker(h)) } });
for (const e of eventsFrom(i, "handoff_rejected")) console.log(`  REJECTED worker return: ${(e.problems as string[]).join(" | ")}`);
console.log(`  retry accepted: total = ${r.fields.total.value}, quote ${JSON.stringify(r.fields.total.quote)}`);

const inv003 = gold.documents.find((d) => d.doc_id === "INV-003")!;
const guess = new Date(Date.parse(`${inv003.fields.invoice_date.value}T00:00:00Z`) + 30 * 864e5).toISOString().slice(0, 10);
i = since();
r = await runExtraction(doc("INV-003"), { docId: "INV-003", log, models: { worker: (h) => (h.task.type === "extract_field" && h.task.field === "due_date" ? workerGuessesFirst(h, guess) : scriptedWorker(h)) } });
for (const e of eventsFrom(i, "handoff_rejected")) console.log(`  REJECTED guess (invoice date + 30 days = ${guess}): ${(e.problems as string[]).join(" | ")}`);
console.log(`  retry accepted: due_date = null, reason: ${r.fields.due_date.reason}`);

const bad = { handoff_id: "injected-1", task_index: 0, doc_id: "INV-999", task: { type: "extract_field", field: "iban" } };
const hc = checkHandoff(bad, FULL_PLAN("INV-001"), "INV-001");
log.write({ type: "handoff_rejected", direction: "planner->worker", handoff: bad, problems: hc.problems });
console.log(`  REJECTED injected handoff ${JSON.stringify(bad.task)}: ${hc.problems.join(" | ")}\n`);

// 6 ------------------------------------------------------------------------------------------
console.log("> 6. human review of INV-016 (held-out document the fixture rules partly miss)");
const dir = mkdtempSync(join(tmpdir(), "review-demo-"));
const store = new ReviewStore(dir);
r = await runExtraction(doc("INV-016"), { docId: "INV-016", log });
store.propose(doc("INV-016"), r);
log.write({ type: "review_proposal", doc_id: "INV-016", null_fields: FIELD_NAMES.filter((f) => r.fields[f].value === null) });
console.log(`  model proposal: ${FIELD_NAMES.filter((f) => r.fields[f].value === null).join(", ")} are null`);
for (const c of [
  { field: "invoice_number", value: "7731", quote: "Faktura 7731", note: "number follows the word Faktura without a label" },
  { field: "supplier", value: "Mälarö Måleri HB", quote: "Mälarö Måleri HB" },
]) {
  const s = store.correct("INV-016", { ...c, reviewer: "reviewer-a" });
  log.write({ type: "review_correction", doc_id: "INV-016", ...s });
  console.log(`  correction #${s.seq} ${s.ts}  ${s.field}: ${short(s.previous.value)} (${s.previous.source}) -> ${short(s.value)}`);
}
let a = await store.approve("INV-016", "reviewer-a");
log.write({ type: "review_approval", doc_id: "INV-016", ...a });
console.log(`  approved ${a.ts} after ${a.corrections_seen} corrections`);
const late = store.correct("INV-016", { field: "net", value: 10000, quote: "10 000,00", reviewer: "reviewer-a" });
log.write({ type: "review_correction", doc_id: "INV-016", ...late });
console.log(`  correction #${late.seq} ${late.ts}  net: null (model) -> 10000`);
try {
  await store.export("INV-016", join(dir, "exports"));
} catch (e) {
  if (!(e instanceof ReviewError)) throw e;
  log.write({ type: "review_export_refused", doc_id: "INV-016", reason: e.message });
  console.log(`  export refused: ${e.message}`);
}
a = await store.approve("INV-016", "reviewer-a");
log.write({ type: "review_approval", doc_id: "INV-016", ...a });
const ex = await store.export("INV-016", join(dir, "exports"));
log.write({ type: "review_export", doc_id: "INV-016", draft: ex.draft });
const prop = store.proposal("INV-016");
console.log(`  re-approved and exported local draft: ${(ex.draft.corrections as unknown[]).length} corrections, proposal.json untouched (net there is still ${short(prop.result.fields.net.value)})`);
const df = ex.draft.fields as Record<string, { value: unknown; source: string }>;
console.log(`  draft: invoice_number ${short(df.invoice_number!.value)} [${df.invoice_number!.source}], net ${short(df.net!.value)} [${df.net!.source}], total ${short(df.total!.value)} [${df.total!.source}], findings: ${(ex.draft.findings as unknown[]).length}`);

const s5 = new ReviewStore(dir);
s5.propose(doc("INV-005"), await runExtraction(doc("INV-005"), { docId: "INV-005", log }));
try {
  await s5.approve("INV-005", "reviewer-a");
} catch (e) {
  console.log(`  INV-005 approval blocked: ${(e as Error).message}`);
}
const a5 = await s5.approve("INV-005", "reviewer-a", ["TOTAL_MISMATCH"]);
log.write({ type: "review_approval", doc_id: "INV-005", ...a5 });
console.log(`  INV-005 approved with TOTAL_MISMATCH acknowledged (the paper invoice really is inconsistent)\n`);
rmSync(dir, { recursive: true, force: true });

// 7 ------------------------------------------------------------------------------------------
console.log("> 7. single-agent baseline vs planner/worker, same 16 documents, same budgets (fixture models only)");
const { summaries } = await runEval({ mode: "fixture" });
console.log(summaryTable(summaries));
console.log("  These numbers measure the scripted fixture models, not a language model. Full report: make eval.");
console.log(`\nlog: ${file}  (code rev ${codeRev()})`);
