import { readFileSync } from "node:fs";
import type { BudgetLimits } from "./budget.ts";
import { runExtraction, type Architecture, type ExtractOptions } from "./extract.ts";
import type { RunLog } from "./log.ts";
import { FIELD_NAMES, type ExtractionResult, type FieldName } from "./schema.ts";

export interface GoldField {
  value: string | number | null;
  quote?: string;
  span?: [number, number];
  reason?: string;
}
export interface GoldDoc {
  doc_id: string;
  file: string;
  tags: string[];
  fields: Record<FieldName, GoldField>;
  expected_findings: string[];
}
export interface Gold {
  dataset: string;
  documents: GoldDoc[];
}

export const loadGold = (): Gold => JSON.parse(readFileSync(new URL("../data/gold.json", import.meta.url), "utf8")) as Gold;
export const loadDoc = (d: GoldDoc) => readFileSync(new URL(`../data/${d.file}`, import.meta.url), "utf8");

/** Codes the eval treats as "the document itself is wrong" and expects the pipeline to flag. */
export const DOC_ERROR_CODES = ["TOTAL_MISMATCH", "DUE_BEFORE_INVOICE"];

/**
 * not_extracted: the pipeline never got to the field (budget, failed plan). It counts as wrong
 * even when the gold value is null, so running out of budget cannot score as a correct abstention.
 */
export type Outcome = "correct" | "correct_null" | "wrong" | "missed" | "guessed" | "not_extracted";

export function scoreField(gold: GoldField, pred: { value: unknown; reason?: string }): Outcome {
  const g = gold.value;
  const p = pred.value;
  if (p === null && pred.reason?.startsWith("not extracted:")) return "not_extracted";
  if (g === null) return p === null ? "correct_null" : "guessed";
  if (p === null || p === undefined) return "missed";
  if (typeof g === "number") return typeof p === "number" && Math.abs(p - g) < 0.005 ? "correct" : "wrong";
  return typeof p === "string" && p.trim() === g ? "correct" : "wrong";
}

export interface DocScore {
  doc_id: string;
  architecture: Architecture;
  budget: string;
  held_out: boolean;
  status: ExtractionResult["status"];
  outcomes: Record<FieldName, Outcome>;
  calls: number;
  tool_calls: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  rejected_plans: number;
  rejected_handoffs: number;
  rejected_finals: number;
  quotes_exact: boolean;
  flagged: string[];
  expected: string[];
}

export function scoreDoc(gold: GoldDoc, text: string, r: ExtractionResult, budget: string): DocScore {
  const outcomes = Object.fromEntries(FIELD_NAMES.map((f) => [f, scoreField(gold.fields[f], r.fields[f])])) as Record<FieldName, Outcome>;
  const codes = new Set(r.findings.map((f) => f.code));
  return {
    doc_id: gold.doc_id,
    architecture: r.architecture,
    budget,
    held_out: gold.tags.includes("held-out"),
    status: r.status,
    outcomes,
    calls: r.calls,
    tool_calls: r.tool_calls,
    input_tokens: r.usage?.input_tokens ?? null,
    output_tokens: r.usage?.output_tokens ?? null,
    cost_usd: r.cost_usd,
    rejected_plans: r.rejections.plans,
    rejected_handoffs: r.rejections.handoffs,
    rejected_finals: r.rejections.finals,
    quotes_exact: FIELD_NAMES.every((f) => r.fields[f].value === null || (r.fields[f].quote !== null && text.includes(r.fields[f].quote!))),
    flagged: DOC_ERROR_CODES.filter((c) => codes.has(c)),
    expected: gold.expected_findings,
  };
}

export interface Summary {
  architecture: Architecture;
  budget: string;
  subset: string;
  docs: number;
  fields: number;
  accuracy: number;
  correct: number;
  wrong: number;
  missed: number;
  guessed: number;
  not_extracted: number;
  quotes_exact_docs: number;
  doc_errors_expected: number;
  doc_errors_flagged: number;
  false_flags: number;
  model_calls: number;
  calls_per_doc: number;
  tool_calls: number;
  rejected: number;
  budget_exhausted_docs: number;
  tokens: number | null;
  cost_usd: number | null;
}

export function summarise(rows: DocScore[], subset: string): Summary {
  const all = rows.flatMap((r) => Object.values(r.outcomes));
  const n = (o: Outcome) => all.filter((x) => x === o).length;
  const correct = n("correct") + n("correct_null");
  const sumOrNull = (xs: (number | null)[]) => (xs.every((x) => x === null) ? null : xs.reduce<number>((a, x) => a + (x ?? 0), 0));
  const first = rows[0]!;
  return {
    architecture: first.architecture,
    budget: first.budget,
    subset,
    docs: rows.length,
    fields: all.length,
    accuracy: all.length ? correct / all.length : 0,
    correct,
    wrong: n("wrong"),
    missed: n("missed"),
    guessed: n("guessed"),
    not_extracted: n("not_extracted"),
    quotes_exact_docs: rows.filter((r) => r.quotes_exact).length,
    doc_errors_expected: rows.reduce((a, r) => a + r.expected.length, 0),
    doc_errors_flagged: rows.reduce((a, r) => a + r.expected.filter((c) => r.flagged.includes(c)).length, 0),
    false_flags: rows.reduce((a, r) => a + r.flagged.filter((c) => !r.expected.includes(c)).length, 0),
    model_calls: rows.reduce((a, r) => a + r.calls, 0),
    calls_per_doc: rows.reduce((a, r) => a + r.calls, 0) / rows.length,
    tool_calls: rows.reduce((a, r) => a + r.tool_calls, 0),
    rejected: rows.reduce((a, r) => a + r.rejected_plans + r.rejected_handoffs + r.rejected_finals, 0),
    budget_exhausted_docs: rows.filter((r) => r.status === "budget_exhausted").length,
    tokens: sumOrNull(rows.map((r) => (r.input_tokens === null ? null : r.input_tokens + (r.output_tokens ?? 0)))),
    cost_usd: sumOrNull(rows.map((r) => r.cost_usd)),
  };
}

export const BUDGETS: Record<string, BudgetLimits> = {
  standard: { maxModelCalls: 30, maxToolCalls: 40 },
  tight: { maxModelCalls: 12, maxToolCalls: 40 },
};

/** Both architectures, every gold document, each budget preset. Same inputs and limits for both. */
export async function runEval(opts: { mode: ExtractOptions["mode"]; log?: RunLog; docs?: string[]; budgets?: string[] }) {
  const gold = loadGold();
  const docs = gold.documents.filter((d) => !opts.docs || opts.docs.includes(d.doc_id));
  const rows: DocScore[] = [];
  for (const budgetName of opts.budgets ?? Object.keys(BUDGETS)) {
    for (const architecture of ["single-agent", "two-agent"] as const) {
      for (const d of docs) {
        const text = loadDoc(d);
        const r = await runExtraction(text, { mode: opts.mode, architecture, docId: d.doc_id, budget: BUDGETS[budgetName], log: opts.log });
        rows.push(scoreDoc(d, text, r, budgetName));
      }
    }
  }
  const summaries: Summary[] = [];
  const groups = new Map<string, DocScore[]>();
  for (const r of rows) {
    const k = `${r.budget}|${r.architecture}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  for (const g of groups.values()) {
    summaries.push(summarise(g, "all"));
    const held = g.filter((r) => r.held_out);
    if (held.length) summaries.push(summarise(held, "held-out"));
  }
  return { dataset: gold.dataset, rows, summaries };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function summaryTable(summaries: Summary[]): string {
  const head = "| budget | architecture | docs | field accuracy | wrong | missed | guessed | not extracted | doc errors flagged | false flags | model calls (per doc) | tool calls | rejected calls | budget hit | tokens | cost |";
  const sep = "|" + " --- |".repeat(16);
  const lines = summaries
    .filter((s) => s.subset === "all")
    .map((s) => `| ${s.budget} | ${s.architecture} | ${s.docs} | ${pct(s.accuracy)} (${s.correct}/${s.fields}) | ${s.wrong} | ${s.missed} | ${s.guessed} | ${s.not_extracted} | ${s.doc_errors_flagged}/${s.doc_errors_expected} | ${s.false_flags} | ${s.model_calls} (${s.calls_per_doc.toFixed(1)}) | ${s.tool_calls} | ${s.rejected} | ${s.budget_exhausted_docs} | ${s.tokens ?? "n/a"} | ${s.cost_usd === null ? "n/a" : `$${s.cost_usd.toFixed(4)}`} |`);
  return [head, sep, ...lines].join("\n");
}

export function heldOutTable(summaries: Summary[]): string {
  const rows = summaries.filter((s) => s.subset === "held-out");
  if (!rows.length) return "";
  return ["| budget | architecture | docs | field accuracy | wrong | missed | guessed |", "|" + " --- |".repeat(7), ...rows.map((s) => `| ${s.budget} | ${s.architecture} | ${s.docs} | ${pct(s.accuracy)} (${s.correct}/${s.fields}) | ${s.wrong} | ${s.missed} | ${s.guessed} |`)].join("\n");
}
