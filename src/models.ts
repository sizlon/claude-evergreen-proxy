/**
 * Model registry resolution + CLI probing.
 *
 * The advertised model list (GET /v1/models) is resolved, in priority order:
 *   1. CLAUDE_PROXY_MODELS env var (comma/space separated)
 *   2. a models.json file written by the `probe-models` command
 *   3. DEFAULT_MODELS (current lineup)
 *
 * Requests are NOT restricted to this list — extractModel passes any explicit
 * `claude-<family>-<version>` id straight through to the CLI. The list only
 * drives discovery (/v1/models) and clients that pick from it.
 */
import { spawn } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

// Current headline lineup — /v1/models fallback and the default probe target.
export const DEFAULT_MODELS = [
  "claude-opus-4-8",
  "claude-sonnet-5",
  "claude-haiku-4-5",
  "claude-fable-5",
];

// Broader candidate set `probe-models` tests when none are given, so it can
// discover which ids (including legacy ones) the CLI still accepts.
export const PROBE_CANDIDATES = [
  "claude-opus-4-8",
  "claude-opus-4-6",
  "claude-opus-4",
  "claude-sonnet-5",
  "claude-sonnet-4-6",
  "claude-sonnet-4-5",
  "claude-sonnet-4",
  "claude-haiku-4-5",
  "claude-haiku-4",
  "claude-fable-5",
];

export function modelsFilePath(): string {
  return process.env.CLAUDE_PROXY_MODELS_FILE || resolve(process.cwd(), "models.json");
}

function parseList(s: string): string[] {
  return s
    .split(/[,\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Resolve the advertised model list: env var > models.json > DEFAULT_MODELS. */
export function resolveModels(): string[] {
  const env = process.env.CLAUDE_PROXY_MODELS;
  if (env && parseList(env).length) return parseList(env);
  const file = modelsFilePath();
  if (existsSync(file)) {
    try {
      const data = JSON.parse(readFileSync(file, "utf-8"));
      const list = Array.isArray(data) ? data : data.models;
      if (Array.isArray(list) && list.length) return list.map(String);
    } catch {
      /* malformed file — fall through to default */
    }
  }
  return DEFAULT_MODELS;
}

// Markers in CLI output that mean the requested model was rejected.
const FAIL_RE =
  /retired|may not exist|issue with the selected model|pick a different model|not have access/i;

export interface ProbeResult {
  id: string;
  ok: boolean;
  detail: string;
}

/** Probe one model id against the CLI; ok=true if the CLI accepts and runs it. */
export function probeModel(id: string, timeoutMs = 60000): Promise<ProbeResult> {
  return new Promise((res) => {
    const bin = process.env.CLAUDE_BIN || "claude";
    const child = spawn(bin, ["-p", "--model", id, "Reply with only: ok"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      res({ id, ok: false, detail: "timeout" });
    }, timeoutMs);
    child.stdout?.on("data", (d) => (out += d.toString()));
    child.stderr?.on("data", (d) => (out += d.toString()));
    child.on("close", (code) => {
      clearTimeout(timer);
      const text = out.trim();
      const ok = code === 0 && text.length > 0 && !FAIL_RE.test(text);
      res({ id, ok, detail: ok ? "ok" : text.slice(0, 120).replace(/\s+/g, " ") || `exit ${code}` });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      res({ id, ok: false, detail: String(e).slice(0, 120) });
    });
  });
}

/** Probe candidates concurrently, write the working ones to models.json. */
export async function probeAndWrite(candidates: string[]): Promise<string[]> {
  const cands = candidates.length ? candidates : PROBE_CANDIDATES;
  console.log(`Probing ${cands.length} model id(s) against the Claude CLI...\n`);
  const results = await Promise.all(cands.map((id) => probeModel(id)));
  for (const r of results) {
    console.log(`  ${r.ok ? "OK  " : "skip"}  ${r.id}${r.ok ? "" : `  — ${r.detail}`}`);
  }
  const working = results.filter((r) => r.ok).map((r) => r.id);
  const file = modelsFilePath();
  writeFileSync(file, JSON.stringify({ models: working }, null, 2) + "\n", "utf-8");
  console.log(`\nWrote ${working.length}/${cands.length} working model(s) → ${file}`);
  console.log("The server now serves these at GET /v1/models.");
  return working;
}
