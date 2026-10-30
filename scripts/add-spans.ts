/**
 * Fills `span: [start, end]` for every gold quote in data/gold.json and fails if a quote is
 * not an exact substring, or occurs more than once without an `anchor` to disambiguate.
 * Run after editing gold.json by hand: npx tsx scripts/add-spans.ts
 */
import { readFileSync, writeFileSync } from "node:fs";

type GoldField = { value: unknown; quote?: string; anchor?: string; span?: [number, number]; reason?: string };
const path = new URL("../data/gold.json", import.meta.url);
const gold = JSON.parse(readFileSync(path, "utf8")) as { documents: { doc_id: string; file: string; fields: Record<string, GoldField> }[] };

let problems = 0;
for (const d of gold.documents) {
  const text = readFileSync(new URL(`../data/${d.file}`, import.meta.url), "utf8");
  for (const [name, f] of Object.entries(d.fields)) {
    if (f.value === null) { delete f.span; continue; }
    if (!f.quote) { console.error(`${d.doc_id}.${name}: value without quote`); problems++; continue; }
    const from = f.anchor ? text.indexOf(f.anchor) : 0;
    if (from < 0) { console.error(`${d.doc_id}.${name}: anchor "${f.anchor}" not found`); problems++; continue; }
    const at = text.indexOf(f.quote, from);
    if (at < 0) { console.error(`${d.doc_id}.${name}: quote "${f.quote}" not found`); problems++; continue; }
    if (!f.anchor && text.indexOf(f.quote, at + 1) >= 0) { console.error(`${d.doc_id}.${name}: quote "${f.quote}" occurs twice, add an anchor`); problems++; continue; }
    f.span = [at, at + f.quote.length];
  }
}
if (problems) process.exit(1);
writeFileSync(path, JSON.stringify(gold, null, 2) + "\n");
console.log(`spans written for ${gold.documents.length} documents`);
