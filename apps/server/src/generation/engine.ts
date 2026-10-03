/** The executor seam of a generation job: `fake` (fixtures) and `claude` (the CLI) implement the same interface. */
import type { GenerationConfig, GenerationErrorKind, GenerationJob } from "@statreel/schemas";
import type { JobPaths } from "./paths";
import type { JobUpdate } from "./queue";

export class GenerationError extends Error {
  constructor(readonly kind: GenerationErrorKind, message: string) {
    super(message);
    this.name = "GenerationError";
  }
}

export type RunContext = {
  job: GenerationJob;
  paths: JobPaths;
  config: GenerationConfig;
  /** aborted on cancel, timeout (only when configured) and lost lease; the engine must kill what it spawned */
  signal: AbortSignal;
  /** record the OS pid of the CLI so recovery can kill its tree */
  setPid(pid: number | null): void;
  /** phase / note / last tool on the job row (relayed to the studio) */
  note(u: JobUpdate): void;
  /** one line into run.log */
  log(line: string): void;
};

export interface GenerationEngine {
  readonly name: string;
  /** Resolves with a result summary; rejects with GenerationError(kind) for known failures. */
  run(ctx: RunContext): Promise<{ result?: Record<string, unknown> }>;
  /** optional extra staging in `prepare` (reference docs, prompt.md); may return values for params_json */
  stage?(job: GenerationJob, paths: JobPaths, caseData: Record<string, unknown>): Promise<Record<string, unknown> | undefined>;
}
