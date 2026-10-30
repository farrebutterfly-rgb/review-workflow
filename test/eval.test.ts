import { test } from "node:test";
import assert from "node:assert/strict";
import { BUDGETS, runEval, scoreField } from "../src/evaluate.ts";
import { FIELD_NAMES } from "../src/schema.ts";
import { docText, gold } from "./helpers.ts";

test("gold set: at least 12 documents, every field labelled, every span points at its quote", () => {
  assert.ok(gold.documents.length >= 12);
  for (const d of gold.documents) {
    const text = docText(d.doc_id);
    for (const f of FIELD_NAMES) {
      const g = d.fields[f];
      assert.ok(g, `${d.doc_id}.${f} labelled`);
      if (g.value === null) assert.ok(g.reason, `${d.doc_id}.${f} null needs reason`);
      else assert.equal(text.slice(g.span![0], g.span![1]), g.quote, `${d.doc_id}.${f} span`);
    }
  }
  const tags = gold.documents.flatMap((d) => d.tags);
  for (const t of ["inconsistent-totals", "ambiguous-dates", "missing-due-date", "missing-org-number", "held-out"]) assert.ok(tags.includes(t), t);
});

test("scoring: abstention, guess, miss, and budget skips", () => {
  assert.equal(scoreField({ value: null }, { value: null, reason: "ambiguous" }), "correct_null");
  assert.equal(scoreField({ value: null }, { value: "2026-04-03" }), "guessed");
  assert.equal(scoreField({ value: 10 }, { value: null, reason: "x" }), "missed");
  assert.equal(scoreField({ value: null }, { value: null, reason: "not extracted: budget exhausted" }), "not_extracted");
  assert.equal(scoreField({ value: 2268 }, { value: 2268.001 }), "correct");
  assert.equal(scoreField({ value: "A" }, { value: "B" }), "wrong");
});

test("comparison runs both architectures on the same documents with the same budgets", async () => {
  const { rows, summaries } = await runEval({ mode: "fixture" });
  for (const b of Object.keys(BUDGETS)) {
    const one = rows.filter((r) => r.budget === b && r.architecture === "single-agent").map((r) => r.doc_id);
    const two = rows.filter((r) => r.budget === b && r.architecture === "two-agent").map((r) => r.doc_id);
    assert.deepEqual(one, two);
    assert.ok(one.length >= 10);
  }
  for (const s of summaries) assert.equal(s.guessed, 0, `${s.budget} ${s.architecture} guessed nothing`);
  const tight2 = summaries.find((s) => s.budget === "tight" && s.architecture === "two-agent" && s.subset === "all")!;
  const tight1 = summaries.find((s) => s.budget === "tight" && s.architecture === "single-agent" && s.subset === "all")!;
  assert.ok(tight2.accuracy < tight1.accuracy, "the worse two-agent result under a tight budget is reported, not hidden");
});
