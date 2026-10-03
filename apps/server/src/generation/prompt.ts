/** Renders the job prompt from `packages/llm/prompts/generation/*.md` (SPEC D.5 "Prompt templates"). */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { GenerationJob } from "@statreel/schemas";
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

export function renderPrompt(job: GenerationJob, caseData: Record<string, unknown>, dir = GENERATION_PROMPTS): string {
  const template = readFileSync(path.join(dir, TEMPLATE[job.type]), "utf8");
  const rules = readFileSync(path.join(dir, "_rules.md"), "utf8").trim();
  // the working directory is data/generation/<id>/work, so the prompt names paths relative to it
  const vars: Record<string, string> = {
    JOB_ID: job.id, CASE_PATH: "case.json", OUT_DIR: "out", REFS_DIR: "refs", VARIANTS: "3", FORMAT: "vertical 9:16 (1080x1920)", FPS: "30",
    DATA_PROVENANCE: dataProvenance(job.type, caseData.data_status),
  };
  // RULES first (it contains no placeholders), then the variables, so a variable value can never inject a rule block
  return templateIn(templateIn(template, { RULES: rules }), vars);
}

/** The audit copy kept next to the logs. */
export function writePrompt(p: JobPaths, text: string): void {
  writeFileSync(p.prompt, text);
}
