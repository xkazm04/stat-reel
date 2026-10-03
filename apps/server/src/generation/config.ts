/**
 * Generation settings (SPEC D.5): code defaults < `.statreel/config.json` -> "generation" < env vars.
 * Loaded by the server and by the worker. Each leaf records where its value came from.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { type GenerationConfig, GenerationConfigSchema } from "@statreel/schemas";
import { paths } from "../config";

export type ConfigSource = "default" | "file" | "env";
export type LoadedGenerationConfig = { config: GenerationConfig; sources: Record<string, ConfigSource> };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Leaf paths ("web.download.maxBytes"); arrays and primitives are leaves. */
function leaves(o: unknown, prefix = ""): string[] {
  if (!isObj(o)) return prefix ? [prefix] : [];
  return Object.entries(o).flatMap(([k, v]) => (isObj(v) ? leaves(v, prefix ? `${prefix}.${k}` : k) : [prefix ? `${prefix}.${k}` : k]));
}

function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k] as Record<string, unknown>, v) : v;
  return out;
}

const bool = (v: string) => !/^(0|false|off|no)$/i.test(v.trim());

/** Environment variables that override the file (names fixed by the spec). */
export function envLayer(env: NodeJS.ProcessEnv): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (env.STATREEL_GEN_ENABLED !== undefined) out.enabled = bool(env.STATREEL_GEN_ENABLED);
  if (env.STATREEL_GEN_WORKER) out.worker = env.STATREEL_GEN_WORKER;
  if (env.GEN_MODE) out.mode = env.GEN_MODE;
  if (env.STATREEL_GEN_BIN) out.cli = { bin: env.STATREEL_GEN_BIN };
  if (env.STATREEL_GEN_MODEL) out.model = env.STATREEL_GEN_MODEL;
  return out;
}

export function readConfigFile(file: string): Record<string, unknown> {
  if (!existsSync(file)) return {};
  const json = JSON.parse(readFileSync(file, "utf8")) as unknown;
  const g = isObj(json) ? json.generation : undefined;
  return isObj(g) ? g : {};
}

export function loadGenerationConfig(opts: { file?: string; env?: NodeJS.ProcessEnv } = {}): LoadedGenerationConfig {
  const file = opts.file ?? path.join(paths.statreelLocal, "config.json");
  const fromFile = readConfigFile(file);
  const fromEnv = envLayer(opts.env ?? process.env);
  const config = GenerationConfigSchema.parse(deepMerge(fromFile, fromEnv));
  const sources: Record<string, ConfigSource> = {};
  for (const k of leaves(config)) sources[k] = "default";
  for (const k of leaves(fromFile)) sources[k] = "file";
  for (const k of leaves(fromEnv)) sources[k] = "env";
  return { config, sources };
}

/** `data/` unless `STATREEL_GEN_DATA` points elsewhere (tests). Server and worker must agree on it. */
export const generationDataRoot = (env: NodeJS.ProcessEnv = process.env) => (env.STATREEL_GEN_DATA ? path.resolve(env.STATREEL_GEN_DATA) : paths.data);
