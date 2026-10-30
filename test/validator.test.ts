import { test } from "node:test";
import assert from "node:assert/strict";
import { runValidator } from "../src/validator.ts";

test("TypeScript calls the Python validator over stdin/stdout", async () => {
  const fields = { net: { value: 100, quote: "100,00" }, vat: { value: 25, quote: "25,00" }, total: { value: 130, quote: "130,00" } };
  const v = await runValidator({ fields, checks: ["totals"] });
  assert.equal(v.ok, false);
  assert.deepEqual(v.findings.map((f) => f.code), ["TOTAL_MISMATCH"]);
  assert.deepEqual(v.checks_run, ["totals"]);
});

test("validator input errors surface as rejections", async () => {
  await assert.rejects(runValidator({ fields: {}, checks: ["vibes" as never] }), /unknown checks/);
});

test("a missing Python interpreter gives a clear error", async () => {
  const saved = process.env.PYTHON;
  process.env.PYTHON = "/nonexistent/python3";
  try {
    await assert.rejects(runValidator({ fields: {} }), /could not start \/nonexistent\/python3.*Python 3\.10/);
  } finally {
    if (saved === undefined) delete process.env.PYTHON;
    else process.env.PYTHON = saved;
  }
});
