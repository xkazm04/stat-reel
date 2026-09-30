import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
export const modes = {
  llm: (process.env.LLM_MODE ?? "live") as Mode,
  audio: (process.env.AUDIO_MODE ?? "live") as Mode,
  publish: (process.env.PUBLISH_MODE ?? "dry") as "live" | "dry",
};

/** Node used for the render worker: x64 on Windows-on-ARM (ADR 004), else the current one. */
export function renderNode(): string {
  if (process.env.RENDER_NODE) return process.env.RENDER_NODE;
  const x64 = path.join(repoRoot, ".tools", "node-x64", "node.exe");
  if (process.platform === "win32" && process.arch === "arm64" && existsSync(x64)) return x64;
  return process.execPath;
}

export const server = { host: "127.0.0.1", port: Number(process.env.STATREEL_PORT ?? 8787) };
