/** Claude Code CLI runner (ADR 010). T7 placeholder: the real runner lands in T8. */
import type { GenerationConfig } from "@statreel/schemas";
import { type GenerationEngine, GenerationError } from "./engine";

export function createLiveEngine(_o: { config: GenerationConfig; dataRoot: string; apiBase: string }): GenerationEngine {
  return {
    name: "claude",
    async run() {
      throw new GenerationError("cli_exit", "the Claude runner is not implemented yet (T8); use GEN_MODE=fake");
    },
  };
}
