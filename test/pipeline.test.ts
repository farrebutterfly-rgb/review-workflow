import { test } from "node:test";
import assert from "node:assert/strict";
import { runExtraction } from "../src/extract.ts";
import { RunLog } from "../src/log.ts";
import { call, ScriptedModel } from "../src/model/scripted.ts";
import { plannerWithBadFirstPlan, scriptedWorker, workerGuessesFirst, workerParaphrasesFirst } from "../src/model/fixtures.ts";
import { FIELD_NAMES, FieldResultSchema, checkField } from "../src/schema.ts";
import { docText, gold } from "./helpers.ts";

const events = (log: RunLog, type: string) => log.events.filter((e) => e.type === type);

test("every document, both architectures: output follows the schema, quotes are exact, nulls have reasons", async () => {
  for (const d of gold.documents) {
    const text = docText(d.doc_id);
    for (const architecture of ["two-agent", "single-agent"] as const) {
      const r = await runExtraction(text, { docId: d.doc_id, architecture });
      assert.equal(r.status, "completed", `${d.doc_id} ${architecture}`);
      assert.equal(r.mode, "fixture");
      for (const f of FIELD_NAMES) {
        assert.ok(FieldResultSchema.safeParse(r.fields[f]).success, `${d.doc_id}.${f}`);
        assert.deepEqual(checkField(f, r.fields[f], text), [], `${d.doc_id}.${f} ${architecture}`);
      }
    }
  }
});

test("missing and ambiguous values are null with a reason, never guessed", async () => {
  for (const d of gold.documents) {
    const r = await runExtraction(docText(d.doc_id), { docId: d.doc_id });
    for (const f of FIELD_NAMES) {
      if (d.fields[f].value === null) {
        assert.equal(r.fields[f].value, null, `${d.doc_id}.${f} should be null`);
        assert.ok(r.fields[f].reason, `${d.doc_id}.${f} needs a reason`);
      }
    }
  }
  const amb = await runExtraction(docText("INV-006"), { docId: "INV-006" });
  assert.match(amb.fields.invoice_date.reason!, /ambiguous/);
});

test("complete document is extracted exactly and the handoffs are logged", async () => {
  const log = new RunLog();
  const r = await runExtraction(docText("INV-001"), { docId: "INV-001", log });
  const g = gold.documents[0]!;
  for (const f of FIELD_NAMES) assert.equal(r.fields[f].value, g.fields[f].value, f);
  assert.equal(events(log, "plan_accepted").length, 1);
  assert.equal(events(log, "handoff").length, 9);
  assert.equal(events(log, "handoff_accepted").length, 9);
  assert.equal(events(log, "check_task").length, 3);
  assert.deepEqual(r.findings, []);
});

test("validator findings for documents that are wrong on paper", async () => {
  const r5 = await runExtraction(docText("INV-005"), { docId: "INV-005" });
  assert.ok(r5.findings.some((f) => f.code === "TOTAL_MISMATCH" && f.source === "validator"));
  const r7 = await runExtraction(docText("INV-007"), { docId: "INV-007", architecture: "single-agent" });
  assert.ok(r7.findings.some((f) => f.code === "DUE_BEFORE_INVOICE"));
});

test("invalid plans are rejected and logged before a valid one is accepted", async () => {
  const log = new RunLog();
  const r = await runExtraction(docText("INV-001"), { docId: "INV-001", log, models: { planner: plannerWithBadFirstPlan } });
  assert.equal(r.status, "completed");
  assert.equal(r.rejections.plans, 2);
  const rej = events(log, "plan_rejected");
  assert.equal(rej.length, 2);
  assert.match((rej[1]!.problems as string[]).join(), /check_totals needs/);
});

test("a planner that never produces a valid plan stops the run with nothing extracted", async () => {
  const bad = () => new ScriptedModel([() => ({ calls: [call("submit_plan", { doc_id: "INV-001", tasks: [{ type: "summarize" }] })] })], "always-bad", true);
  const log = new RunLog();
  const r = await runExtraction(docText("INV-001"), { docId: "INV-001", log, models: { planner: bad } });
  assert.equal(r.status, "plan_rejected");
  assert.equal(events(log, "plan_rejected").length, 3);
  assert.equal(events(log, "handoff").length, 0, "no worker ran");
  assert.ok(FIELD_NAMES.every((f) => r.fields[f].value === null));
  assert.ok(r.findings.some((f) => f.code === "NO_VALID_PLAN"));
});

test("a worker return with a paraphrased quote is rejected, logged and retried", async () => {
  const log = new RunLog();
  const r = await runExtraction(docText("INV-005"), {
    docId: "INV-005",
    log,
    models: { worker: (h) => (h.task.type === "extract_field" && h.task.field === "total" ? workerParaphrasesFirst(h) : scriptedWorker(h)) },
  });
  const rej = events(log, "handoff_rejected");
  assert.equal(rej.length, 1);
  assert.match((rej[0]!.problems as string[])[0]!, /not an exact substring/);
  assert.equal(r.fields.total.quote, "8 867,50");
  assert.equal(r.rejections.handoffs, 1);
});

test("a guessed value with an invented quote is refused; the field ends null", async () => {
  const log = new RunLog();
  const r = await runExtraction(docText("INV-003"), {
    docId: "INV-003",
    log,
    models: { worker: (h) => (h.task.type === "extract_field" && h.task.field === "due_date" ? workerGuessesFirst(h, "2026-09-28") : scriptedWorker(h)) },
  });
  assert.equal(events(log, "handoff_rejected").length, 1);
  assert.equal(r.fields.due_date.value, null);
});

test("a worker answering for the wrong field is rejected", async () => {
  const log = new RunLog();
  const wrong = () => new ScriptedModel([() => ({ calls: [call("submit_field", { field: "vat", value: 1727.5, quote: "1 727,50" })] })], "wrong-field", true);
  const r = await runExtraction(docText("INV-001"), { docId: "INV-001", log, models: { worker: (h) => (h.task.type === "extract_field" && h.task.field === "net" ? wrong() : scriptedWorker(h)) } });
  assert.match((events(log, "handoff_rejected")[0]!.problems as string[])[0]!, /asked for net, got vat/);
  assert.equal(r.fields.net.value, null);
  assert.match(r.fields.net.reason!, /not extracted/);
});

test("same budget for both: a tight budget leaves two-agent fields unextracted, never guessed", async () => {
  const budget = { maxModelCalls: 12, maxToolCalls: 40 };
  const two = await runExtraction(docText("INV-001"), { docId: "INV-001", budget });
  const one = await runExtraction(docText("INV-001"), { docId: "INV-001", budget, architecture: "single-agent" });
  assert.equal(two.calls, 12);
  assert.equal(two.status, "budget_exhausted");
  assert.ok(two.findings.some((f) => f.code === "BUDGET_EXHAUSTED"));
  const skipped = FIELD_NAMES.filter((f) => two.fields[f].reason?.startsWith("not extracted"));
  assert.ok(skipped.length > 0);
  for (const f of skipped) assert.equal(two.fields[f].value, null);
  assert.equal(one.status, "completed");
  assert.ok(one.calls <= 12);
});

test("live mode without a key fails with a clear message", async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  await assert.rejects(runExtraction("x", { mode: "live" }), /ANTHROPIC_API_KEY is not set/);
  if (saved) process.env.ANTHROPIC_API_KEY = saved;
});
