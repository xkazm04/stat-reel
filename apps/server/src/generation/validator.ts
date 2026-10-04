/**
 * Output validation at finalize (SPEC D.7): the interface the worker calls. Production wires
 * `dataRaceValidator` (validate-data-race.ts: DataRacePropsSchema + checkGenerationRules, the same function
 * finalize and validate_generation_output run). `stubValidator` only checks that the contracted files exist
 * and parse; it is the worker's fallback when no validator is passed (unit tests).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { GenerationJobType } from "@statreel/schemas";
import type { JobPaths } from "./paths";

export type ValidationResult = { ok: boolean; errors: string[]; outputs: string[] };
export interface GenerationValidator {
  validate(ctx: { type: GenerationJobType; paths: JobPaths }): Promise<ValidationResult>;
}

const parseError = (file: string): string | null => {
  try {
    JSON.parse(readFileSync(file, "utf8"));
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};

export const stubValidator: GenerationValidator = {
  async validate({ type, paths }) {
    const errors: string[] = [];
    const outputs: string[] = [];
    const need = (rel: string, json = true) => {
      const abs = path.join(paths.out, rel);
      if (!existsSync(abs)) return void errors.push(`missing output: out/${rel}`);
      outputs.push(`out/${rel}`);
      const bad = json ? parseError(abs) : null;
      if (bad) errors.push(`out/${rel} is not valid JSON: ${bad}`);
    };
    if (type === "visual_options") {
      for (const n of [1, 2, 3]) {
        need(`variants/v${n}.props.json`);
        need(`variants/v${n}.md`, false);
      }
    } else {
      need("props.json");
    }
    need("timing-plan.json");
    need("assets.json");
    if (existsSync(paths.assets)) {
      for (const f of readdirSync(paths.assets, { recursive: true, withFileTypes: true })) {
        if (f.isFile()) outputs.push(`assets/${path.relative(paths.assets, path.join(f.parentPath, f.name)).split(path.sep).join("/")}`);
      }
    }
    return { ok: errors.length === 0, errors, outputs };
  },
};
