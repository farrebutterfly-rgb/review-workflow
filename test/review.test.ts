import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runExtraction } from "../src/extract.ts";
import { ReviewError, ReviewStore } from "../src/review/store.ts";
import { docText } from "./helpers.ts";

/** Clock that advances one minute per call, so timestamps are distinct and predictable. */
const clock = () => {
  let t = Date.parse("2026-10-30T09:00:00Z");
  return () => new Date((t += 60_000));
};

async function fresh(id = "INV-016") {
  const dir = mkdtempSync(join(tmpdir(), "review-test-"));
  const store = new ReviewStore(dir, clock());
  const text = docText(id);
  store.propose(text, await runExtraction(text, { docId: id }));
  return { dir, store, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("corrections are stored separately; the model proposal is never changed", async () => {
  const { dir, store, cleanup } = await fresh();
  try {
    const before = readFileSync(join(dir, "INV-016", "proposal.json"), "utf8");
    const c = store.correct("INV-016", { field: "invoice_number", value: "7731", quote: "Faktura 7731", reviewer: "r1" });
    assert.equal(c.seq, 1);
    assert.deepEqual(c.previous, { value: null, source: "model" });
    assert.equal(readFileSync(join(dir, "INV-016", "proposal.json"), "utf8"), before);
    assert.equal(store.proposal("INV-016").result.fields.invoice_number.value, null, "model value kept");
    const d = store.draft("INV-016");
    assert.equal(d.invoice_number.value, "7731");
    assert.equal(d.invoice_number.source, "human");
    assert.equal(d.invoice_number.proposed.value, null);
    assert.ok(Date.parse(store.proposal("INV-016").created_at) < Date.parse(c.ts), "both carry timestamps, in order");
  } finally {
    cleanup();
  }
});

test("a second correction of the same field keeps the whole history", async () => {
  const { store, cleanup } = await fresh();
  try {
    store.correct("INV-016", { field: "net", value: 9000, quote: "9 000,00", reviewer: "r1" });
    const c2 = store.correct("INV-016", { field: "net", value: 10000, quote: "10 000,00", reviewer: "r2", note: "first value was a line item" });
    assert.deepEqual(c2.previous, { value: 9000, source: "human" });
    assert.equal(store.corrections("INV-016").length, 2);
    assert.equal(store.draft("INV-016").net.value, 10000);
  } finally {
    cleanup();
  }
});

test("bad corrections are refused", async () => {
  const { store, cleanup } = await fresh();
  try {
    assert.throws(() => store.correct("INV-016", { field: "iban", value: "x", reviewer: "r" }), ReviewError);
    assert.throws(() => store.correct("INV-016", { field: "net", value: 1, quote: "not in the document", reviewer: "r" }), /not an exact substring/);
    assert.throws(() => store.correct("INV-016", { field: "invoice_date", value: "30/09/2026", reviewer: "r" }), /YYYY-MM-DD/);
    assert.throws(() => store.correct("INV-016", { field: "vat", value: null, reviewer: "r" }), /needs a reason/);
    assert.throws(() => store.correct("INV-016", { field: "vat", value: 1, reviewer: " " }), /reviewer/);
    assert.equal(store.corrections("INV-016").length, 0);
  } finally {
    cleanup();
  }
});

test("proposals cannot be overwritten", async () => {
  const { store, cleanup } = await fresh();
  try {
    const text = docText("INV-016");
    await assert.rejects(async () => store.propose(text, await runExtraction(text, { docId: "INV-016" })), /never overwritten/);
  } finally {
    cleanup();
  }
});

test("export needs an approval that saw every correction", async () => {
  const { dir, store, cleanup } = await fresh();
  try {
    const out = join(dir, "exports");
    await assert.rejects(store.export("INV-016", out), /not approved/);
    store.correct("INV-016", { field: "invoice_number", value: "7731", quote: "Faktura 7731", reviewer: "r1" });
    await store.approve("INV-016", "r1");
    store.correct("INV-016", { field: "supplier", value: "Mälarö Måleri HB", quote: "Mälarö Måleri HB", reviewer: "r1" });
    await assert.rejects(store.export("INV-016", out), /after the last approval/);
    await store.approve("INV-016", "r1");
    const { file, draft } = await store.export("INV-016", out);
    assert.ok(existsSync(file));
    const fields = draft.fields as Record<string, { value: unknown; source: string }>;
    assert.equal(fields.invoice_number!.source, "human");
    assert.equal(fields.total!.source, "model");
    const mp = draft.model_proposal as { fields: Record<string, { value: unknown }> };
    assert.equal(mp.fields.invoice_number!.value, null, "export keeps the original proposal next to the corrected draft");
    assert.equal((draft.corrections as unknown[]).length, 2);
  } finally {
    cleanup();
  }
});

test("error findings block approval unless acknowledged", async () => {
  const { store, cleanup } = await fresh("INV-005");
  try {
    await assert.rejects(store.approve("INV-005", "r1"), /unresolved TOTAL_MISMATCH/);
    const a = await store.approve("INV-005", "r1", ["TOTAL_MISMATCH"]);
    assert.deepEqual(a.acknowledged, ["TOTAL_MISMATCH"]);
  } finally {
    cleanup();
  }
});
