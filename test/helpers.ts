import { loadDoc, loadGold } from "../src/evaluate.ts";
export const gold = loadGold();
export const docText = (id: string) => loadDoc(gold.documents.find((d) => d.doc_id === id)!);
