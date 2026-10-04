import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const data = path.join(repoRoot, "data");

export const paths = {
  repo: repoRoot,
  data,
  registry: path.join(data, "registry", "sources.yaml"),
  usecases: path.join(data, "registry", "usecases"),
  warehouse: path.resolve(repoRoot, process.env.STATREEL_WAREHOUSE ?? path.join(data, "warehouse.duckdb")),
  appDb: path.resolve(repoRoot, process.env.STATREEL_APP_DB ?? path.join(data, "app.sqlite")),
  renders: path.join(data, "renders"),
  audio: path.join(data, "audio"),
  board: path.join(data, "board"),
  fixtures: path.join(repoRoot, "e2e", "fixtures"),
  fonts: path.join(repoRoot, "fonts"),
  policy: path.join(repoRoot, "policy"),
  statreelLocal: path.join(repoRoot, ".statreel"),
};

export type Mode = "live" | "replay";

/**
 * Boot-time env contract. A mode typo (LLM_MODE=reply) must never fall through to the paid or public
 * path, so unknown values are an error, not a default; unset keeps the documented default
 * (llm/audio live, publish dry). Empty numeric values count as unset; an explicit empty mode is an error.
 */
const mode = <const T extends readonly [string, ...string[]]>(key: string, values: T, fallback: T[number]) =>
  z.enum(values as unknown as [T[number], ...T[number][]], { errorMap: () => ({ message: `${key} must be one of ${values.join(" | ")}` }) }).default(fallback);
const num = (key: string, opts: { int?: boolean; min: number; max?: number }) =>
  z.preprocess(
    (v) => (v === undefined || v === "" ? undefined : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN),
    (() => {
      let n = z.number({ invalid_type_error: `${key} must be a number` });
      if (opts.int) n = n.int(`${key} must be an integer`);
      n = n.min(opts.min, `${key} must be >= ${opts.min}`);
      if (opts.max !== undefined) n = n.max(opts.max, `${key} must be <= ${opts.max}`);
      return n.optional();
    })(),
  );

const EnvSchema = z.object({
  LLM_MODE: mode("LLM_MODE", ["live", "replay"], "live"),
  AUDIO_MODE: mode("AUDIO_MODE", ["live", "replay"], "live"),
  PUBLISH_MODE: mode("PUBLISH_MODE", ["live", "dry"], "dry"),
  STATREEL_PORT: num("STATREEL_PORT", { int: true, min: 1, max: 65535 }),
  STATREEL_JOB_RETENTION_DAYS: num("STATREEL_JOB_RETENTION_DAYS", { min: 0.000001 }),
  STATREEL_CALENDAR_MISSED_MIN: num("STATREEL_CALENDAR_MISSED_MIN", { min: 0.000001 }),
  STATREEL_RENDER_TIMEOUT_MS: num("STATREEL_RENDER_TIMEOUT_MS", { min: 1 }),
  GEN_FAKE_DELAY_MS: num("GEN_FAKE_DELAY_MS", { min: 0 }),
});
export type ParsedEnv = z.infer<typeof EnvSchema>;

/** Parse the config env once; throws ONE error that lists every bad key with its allowed values. */
export function parseEnv(env: Record<string, string | undefined> = process.env): ParsedEnv {
  const r = EnvSchema.safeParse(env);
  if (r.success) return r.data;
  const lines = r.error.issues.map((i) => `  ${i.message}${i.path.length ? ` (got ${JSON.stringify(env[String(i.path[0])])})` : ""}`);
  throw new Error(["invalid environment:", ...lines].join("\n"));
}

const env = parseEnv();
export const modes: { llm: Mode; audio: Mode; publish: "live" | "dry" } = { llm: env.LLM_MODE, audio: env.AUDIO_MODE, publish: env.PUBLISH_MODE };

/** Node used for the render worker: x64 on Windows-on-ARM (ADR 004), else the current one. */
export function renderNode(): string {
  if (process.env.RENDER_NODE) return process.env.RENDER_NODE;
  const x64 = path.join(repoRoot, ".tools", "node-x64", "node.exe");
  if (process.platform === "win32" && process.arch === "arm64" && existsSync(x64)) return x64;
  return process.execPath;
}

export const server = { host: "127.0.0.1", port: env.STATREEL_PORT ?? 8787 };
