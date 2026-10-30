/** Live comparison on a few documents. Needs ANTHROPIC_API_KEY and costs money. */
import { spawnSync } from "node:child_process";
import { MissingApiKeyError } from "../extract.ts";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error(new MissingApiKeyError().message);
  console.error("Set ANTHROPIC_API_KEY (and optionally AGENT_MODEL, PRICE_INPUT_PER_MTOK, PRICE_OUTPUT_PER_MTOK) and run again.");
  process.exit(2);
}
const docs = process.argv[2] ?? "INV-001,INV-003,INV-005,INV-006,INV-016";
const r = spawnSync(process.execPath, ["--import", "tsx", "src/cli/eval.ts", "--live", "--docs", docs, "--budgets", "standard"], { stdio: "inherit" });
process.exit(r.status ?? 1);
