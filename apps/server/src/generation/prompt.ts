/** Renders the job prompt from `packages/llm/prompts/generation/*.md` (SPEC D.5 "Prompt templates"). */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { GenerationConfig, GenerationJob } from "@statreel/schemas";
import { templateIn } from "@statreel/llm";
import { repoRoot } from "../config";
import type { JobPaths } from "./paths";

export const GENERATION_PROMPTS = path.join(repoRoot, "packages", "llm", "prompts", "generation");
const TEMPLATE: Record<GenerationJob["type"], string> = { visual_options: "visual-options.md", generate_video: "generate-video.md" };

/** `real` only for staged/registry cases; everything else is a labelled design preview (SPEC D.6). */
export function dataProvenance(type: GenerationJob["type"], dataStatus: unknown): "real" | "sample" {
  if (type === "generate_video") return "real"; // the gate (T11) only lets real-data cases through
  return dataStatus === "staged" || dataStatus === "registry" ? "real" : "sample";
}

export type PromptWeb = Pick<GenerationConfig["web"], "search" | "fetch">;

/**
 * How the session finds a logo page, naming only the web tools `buildClaudeArgs` gives this run (registry
 * prompt-assembly/capability-documentation: the prompt never teaches a tool the CLI denies).
 */
export function webFindText(web: PromptWeb): string {
  const tools = [web.search ? "WebSearch" : null, web.fetch ? "WebFetch" : null].filter(Boolean);
  if (tools.length) return `Use ${tools.join(" and ")} to find the Commons file page,`;
  return "Web search and web fetch are off for this run: pass a Commons file page only when you know it exists (fetch_asset checks it with the Commons API),";
}

/** `web` is required so the caller cannot forget it: the tools in the prompt must be the tools the run gets. */
export function renderPrompt(job: GenerationJob, caseData: Record<string, unknown>, web: PromptWeb, dir = GENERATION_PROMPTS): string {
  const template = readFileSync(path.join(dir, TEMPLATE[job.type]), "utf8");
  const rules = readFileSync(path.join(dir, "_rules.md"), "utf8").trim();
  // the working directory is data/generation/<id>/work, so the prompt names paths relative to it
  const vars: Record<string, string> = {
    JOB_ID: job.id, CASE_PATH: "case.json", OUT_DIR: "out", REFS_DIR: "refs", VARIANTS: "3", FORMAT: "vertical 9:16 (1080x1920)", FPS: "30",
    DATA_PROVENANCE: dataProvenance(job.type, caseData.data_status), WEB_FIND: webFindText(web),
  };
  // RULES first (it contains no placeholders), then the variables, so a variable value can never inject a rule block
  return templateIn(templateIn(template, { RULES: rules }), vars);
}

/** The audit copy kept next to the logs. */
export function writePrompt(p: JobPaths, text: string): void {
  writeFileSync(p.prompt, text);
}
