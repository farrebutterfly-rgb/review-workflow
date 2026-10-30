/**
 * Local review step. State lives in .review/ (or $REVIEW_DIR); exports go to exports/.
 *
 *   npm run review -- propose <document.txt> [--doc-id ID] [--arch two-agent|single-agent]
 *   npm run review -- show <doc_id>
 *   npm run review -- correct <doc_id> <field> <value|null> --by <name> [--quote "exact text"] [--reason "..."] [--note "..."]
 *   npm run review -- approve <doc_id> --by <name> [--ack TOTAL_MISMATCH,...]
 *   npm run review -- export <doc_id> [--out exports]
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { runExtraction, type Architecture } from "../extract.ts";
import { ReviewError, ReviewStore } from "../review/store.ts";
import { AMOUNT_FIELDS, FIELD_NAMES, type FieldName } from "../schema.ts";
import { arg } from "./common.ts";

const [cmd, a1, a2, a3] = process.argv.slice(2);
const argv = process.argv.slice(2);
const store = new ReviewStore(process.env.REVIEW_DIR ?? ".review");

async function show(docId: string) {
  const d = store.draft(docId);
  const p = store.proposal(docId);
  console.log(`${docId}  proposed ${p.created_at} by ${p.result.model} (${p.result.architecture}, ${p.result.mode})`);
  for (const f of FIELD_NAMES) {
    const x = d[f];
    const v = x.value === null ? `null  (${x.reason})` : `${JSON.stringify(x.value)}  quote ${JSON.stringify(x.quote)}`;
    const was = x.source === "human" ? `   [human ${x.corrected_at} by ${x.corrected_by}; model said ${JSON.stringify(x.proposed.value)}]` : "";
    console.log(`  ${f.padEnd(15)} ${v}${was}`);
  }
  const findings = await store.findings(docId);
  console.log(findings.length ? findings.map((f) => `  ${f.severity.toUpperCase().padEnd(7)} ${f.code}${f.field ? ` (${f.field})` : ""}: ${f.message}`).join("\n") : "  no findings");
  const last = store.approvals(docId).at(-1);
  console.log(last ? `  approved ${last.ts} by ${last.reviewer}${last.corrections_seen !== store.corrections(docId).length ? " (stale: corrected since)" : ""}` : "  not approved");
}

try {
  switch (cmd) {
    case "propose": {
      if (!a1) throw new ReviewError("usage: propose <document.txt>");
      const text = readFileSync(a1, "utf8");
      const docId = arg(argv, "--doc-id") ?? basename(a1).replace(/\.[^.]+$/, "");
      const r = await runExtraction(text, { docId, architecture: (arg(argv, "--arch") ?? "two-agent") as Architecture });
      store.propose(text, r);
      await show(docId);
      break;
    }
    case "show":
      await show(a1 ?? "");
      break;
    case "correct": {
      if (!a1 || !a2 || a3 === undefined) throw new ReviewError("usage: correct <doc_id> <field> <value|null> --by <name>");
      const raw = a3 === "null" ? null : AMOUNT_FIELDS.includes(a2 as FieldName) ? Number(a3) : a3;
      const c = store.correct(a1, { field: a2, value: raw, quote: arg(argv, "--quote") ?? null, reason: arg(argv, "--reason"), note: arg(argv, "--note"), reviewer: arg(argv, "--by") ?? "" });
      console.log(`correction #${c.seq} stored ${c.ts}: ${c.field} ${JSON.stringify(c.previous.value)} (${c.previous.source}) -> ${JSON.stringify(c.value)}`);
      break;
    }
    case "approve": {
      const ack = arg(argv, "--ack")?.split(",") ?? [];
      const a = await store.approve(a1 ?? "", arg(argv, "--by") ?? "", ack);
      console.log(`approved ${a.ts} by ${a.reviewer}, ${a.corrections_seen} correction(s)${a.acknowledged.length ? `, acknowledged ${a.acknowledged.join(", ")}` : ""}`);
      break;
    }
    case "export": {
      const { file } = await store.export(a1 ?? "", arg(argv, "--out") ?? "exports");
      console.log(`wrote ${file}`);
      break;
    }
    default:
      console.error("commands: propose, show, correct, approve, export (see the header of src/cli/review.ts)");
      process.exit(64);
  }
} catch (e) {
  if (e instanceof ReviewError) {
    console.error(`review: ${e.message}`);
    process.exit(1);
  }
  throw e;
}
