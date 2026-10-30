import { test } from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "../src/registry.ts";
import { makeReadTools } from "../src/tools/readTools.ts";
import { docText } from "./helpers.ts";

const reg = new ToolRegistry(makeReadTools(new Map([["INV-001", docText("INV-001")]])));

test("read_lines returns exact text with line numbers and enforces its range", async () => {
  const r = await reg.execute("read_lines", { doc_id: "INV-001", from: 1, to: 3 });
  assert.ok(r.ok);
  const lines = (r.result as { lines: { n: number; text: string }[] }).lines;
  assert.deepEqual(lines[0], { n: 1, text: "Norrsken Kontorsvaror AB" });
  const tooMany = await reg.execute("read_lines", { doc_id: "INV-001", from: 1, to: 200 });
  assert.equal(!tooMany.ok && tooMany.error.code, "INVALID_ARGUMENTS");
});

test("search_text is case-insensitive and literal", async () => {
  const r = await reg.execute("search_text", { doc_id: "INV-001", any_of: ["att betala", "(not here)"] });
  assert.ok(r.ok);
  assert.deepEqual((r.result as { matches: { text: string }[] }).matches.map((m) => m.text), ["Att betala: 8 637,50"]);
});

test("unknown document and unknown tool are errors, not crashes", async () => {
  const r = await reg.execute("get_document_info", { doc_id: "NOPE" });
  assert.equal(!r.ok && r.error.code, "NOT_FOUND");
  const u = await reg.execute("write_file", {});
  assert.equal(!u.ok && u.error.code, "UNKNOWN_TOOL");
});
