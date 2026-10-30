import { test } from "node:test";
import assert from "node:assert/strict";
import { checkField, validatePlan } from "../src/schema.ts";
import { checkHandoff } from "../src/pipeline.ts";
import { FULL_PLAN } from "../src/model/fixtures.ts";

const DOC = "Fakturanummer: SF-3381\nAtt betala: 8 867,50\n";

test("a value needs a quote that is an exact substring", () => {
  assert.deepEqual(checkField("total", { value: 8867.5, quote: "8 867,50" }, DOC), []);
  assert.match(checkField("total", { value: 8867.5, quote: "8867.50" }, DOC)[0]!, /not an exact substring/);
  assert.match(checkField("total", { value: 8867.5, quote: null }, DOC)[0]!, /needs a source quote/);
});

test("a null value needs a reason and no quote", () => {
  assert.deepEqual(checkField("due_date", { value: null, quote: null, reason: "not written" }, DOC), []);
  assert.match(checkField("due_date", { value: null, quote: null }, DOC)[0]!, /reason is required/);
  assert.match(checkField("due_date", { value: null, quote: "8 867,50", reason: "x y z" }, DOC)[0]!, /quote must be null/);
});

test("typed values: dates, currency, org number, amounts", () => {
  assert.match(checkField("invoice_date", { value: "2026-02-30", quote: "SF-3381" }, DOC).join(), /calendar/);
  assert.match(checkField("currency", { value: "kr", quote: "SF-3381" }, DOC).join(), /ISO 4217/);
  assert.match(checkField("total", { value: "8867.5", quote: "8 867,50" }, DOC).join(), /number/);
});

test("verbatim fields must appear inside their quote", () => {
  assert.deepEqual(checkField("invoice_number", { value: "SF-3381", quote: "SF-3381" }, DOC), []);
  assert.match(checkField("invoice_number", { value: "SF-3382", quote: "SF-3381" }, DOC).join(), /does not appear in its quote/);
});

test("plans outside the bounded schema are rejected", () => {
  assert.ok(validatePlan({ doc_id: "D", tasks: [{ type: "summarize" }] }, "D").problems.length > 0);
  assert.ok(validatePlan({ doc_id: "D", tasks: [{ type: "extract_field", field: "iban" }] }, "D").problems.length > 0);
  assert.ok(validatePlan({ doc_id: "D", tasks: [{ type: "extract_field", field: "net", extra: 1 }] }, "D").problems.length > 0, "unknown keys");
  assert.ok(validatePlan({ doc_id: "D", tasks: [] }, "D").problems.length > 0, "empty plan");
});

test("plan ordering rules", () => {
  const p = (tasks: unknown[]) => validatePlan({ doc_id: "D", tasks }, "D").problems.join(" | ");
  assert.match(p([{ type: "check_totals" }, { type: "extract_field", field: "net" }]), /check_totals needs net, vat, total/);
  assert.match(p([{ type: "extract_field", field: "net" }, { type: "extract_field", field: "net" }]), /extracted twice/);
  assert.match(p([{ type: "extract_field", field: "net" }, { type: "flag_missing" }, { type: "extract_field", field: "vat" }]), /flag_missing must be the last/);
  assert.match(validatePlan({ doc_id: "OTHER", tasks: [{ type: "extract_field", field: "net" }] }, "D").problems.join(), /does not match/);
  assert.deepEqual(validatePlan(FULL_PLAN("D"), "D").problems, []);
});

test("handoffs that do not match the accepted plan are rejected", () => {
  const plan = FULL_PLAN("D");
  const ok = { handoff_id: "h0", task_index: 0, doc_id: "D", task: plan.tasks[0] };
  assert.deepEqual(checkHandoff(ok, plan, "D").problems, []);
  assert.match(checkHandoff({ ...ok, doc_id: "E" }, plan, "D").problems.join(), /run is for D/);
  assert.match(checkHandoff({ ...ok, task_index: 3 }, plan, "D").problems.join(), /not the task in the accepted plan/);
  assert.match(checkHandoff({ ...ok, task_index: 99 }, plan, "D").problems.join(), /not the task in the accepted plan/);
  assert.ok(checkHandoff({ ...ok, task: { type: "extract_field", field: "iban" } }, plan, "D").problems.length > 0);
  assert.ok(checkHandoff({ ...ok, sneaky: true }, plan, "D").problems.length > 0);
});
