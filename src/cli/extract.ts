/**
 * npm run --silent extract -- --json <file> [--arch two-agent|single-agent] [--doc-id ID] [--live]
 * Prints exactly one JSON object on stdout. Errors go to stderr with a non-zero exit code.
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { MissingApiKeyError, runExtraction, toPublicJson, type Architecture } from "../extract.ts";
import { arg } from "./common.ts";

const argv = process.argv.slice(2);
const file = arg(argv, "--json");
const arch = (arg(argv, "--arch") ?? "two-agent") as Architecture;
if (!file || !["two-agent", "single-agent"].includes(arch)) {
  console.error("usage: npm run --silent extract -- --json <document.txt> [--arch two-agent|single-agent] [--doc-id ID] [--live]");
  process.exit(64);
}
let text: string;
try {
  text = readFileSync(file, "utf8");
} catch (e) {
  console.error(`cannot read ${file}: ${(e as Error).message}`);
  process.exit(66);
}
const docId = arg(argv, "--doc-id") ?? basename(file).replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 64);
try {
  const r = await runExtraction(text, { architecture: arch, docId, mode: argv.includes("--live") ? "live" : "fixture" });
  process.stdout.write(JSON.stringify(toPublicJson(r), null, 2) + "\n");
} catch (e) {
  console.error((e as Error).message);
  process.exit(e instanceof MissingApiKeyError ? 2 : 1);
}
