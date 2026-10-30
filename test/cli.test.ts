import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const run = (args: string[], env: NodeJS.ProcessEnv = process.env) => spawnSync(process.execPath, ["--import", "tsx", ...args], { encoding: "utf8", env });

test("extract CLI prints one JSON object with fields, findings, calls and mode", () => {
  const p = run(["src/cli/extract.ts", "--json", "data/docs/INV-003.txt"]);
  assert.equal(p.status, 0, p.stderr);
  const out = JSON.parse(p.stdout);
  assert.equal(out.mode, "fixture");
  assert.equal(typeof out.calls, "number");
  assert.equal(out.fields.total.value, 18675);
  assert.equal(out.fields.total.quote, "18 675,00");
  assert.equal(out.fields.due_date.value, null);
  assert.ok(out.fields.due_date.reason);
  assert.ok(Array.isArray(out.findings));
});

test("extract CLI live mode without a key exits 2 with a message", () => {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  const p = run(["src/cli/extract.ts", "--json", "data/docs/INV-003.txt", "--live"], env);
  assert.equal(p.status, 2);
  assert.match(p.stderr, /ANTHROPIC_API_KEY is not set/);
  assert.equal(p.stdout, "");
});

test("live entry point exits 2 without a key", () => {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  const p = run(["src/cli/live.ts"], env);
  assert.equal(p.status, 2);
});
