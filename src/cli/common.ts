import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { pythonBin } from "../validator.ts";

export const stamp = () => new Date().toISOString().slice(0, 10);
export const codeRev = () => {
  try {
    const rev = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const dirty = execSync("git status --porcelain -- src validator data", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return dirty ? `${rev}-dirty` : rev;
  } catch {
    return "uncommitted";
  }
};
export const pythonVersion = () => {
  try {
    return execSync(`${pythonBin()} --version`, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
  } catch {
    return "python not found";
  }
};

/** First line of every evidence file. */
export function sessionRecord(mode: "fixture" | "live", dataset: string, extra: Record<string, unknown> = {}): Record<string, unknown> & { code_rev: string; node: string; python: string } {
  return { type: "session", ts: new Date().toISOString(), code_rev: codeRev(), dataset, node: process.version, python: pythonVersion(), mode, ...extra };
}

export function startEvidence(file: string, session: object) {
  mkdirSync("evidence", { recursive: true });
  writeFileSync(file, JSON.stringify(session) + "\n");
}

export function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}
