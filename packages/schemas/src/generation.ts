/**
 * Generation queue contract (ADR 010, SPEC D.3/D.5/D.9): job rows, the enqueue request and the
 * machine-local configuration. Shared by the server, the worker process and (later) the studio.
 */
import { z } from "zod";

export const CASE_ID_RE = /^ci-[0-9a-f]{8}$/;
export const BOARD_ITEM_ID_RE = /^bd-[0-9a-f]{8}$/;
export const GENERATION_JOB_ID_RE = /^gj-[0-9a-f]{8}$/;
/** Model ids and domain names are the only config strings that reach argv: pattern-checked. */
export const MODEL_ID_RE = /^[a-z0-9.\-_:[\]]+$/i;
export const DOMAIN_RE = /^[a-z0-9.-]+$/i;

export const GenerationJobType = z.enum(["visual_options", "generate_video"]);
export type GenerationJobType = z.infer<typeof GenerationJobType>;
export const GenerationJobStatus = z.enum(["queued", "running", "done", "failed", "cancelled"]);
export type GenerationJobStatus = z.infer<typeof GenerationJobStatus>;
export const GenerationErrorKind = z.enum(["timeout", "cli_exit", "validation", "render", "data_gate", "interrupted", "cancelled", "budget"]);
export type GenerationErrorKind = z.infer<typeof GenerationErrorKind>;

export const GenerationJobSchema = z.object({
  id: z.string().regex(GENERATION_JOB_ID_RE),
  type: GenerationJobType,
  case_id: z.string().regex(CASE_ID_RE),
  board_item_id: z.string().regex(BOARD_ITEM_ID_RE).nullable(),
  dedupe_key: z.string(),
  status: GenerationJobStatus,
  attempts: z.number().int(),
  max_attempts: z.number().int(),
  params_json: z.string(),
  result_json: z.string().nullable(),
  error: z.string().nullable(),
  error_kind: GenerationErrorKind.nullable(),
  log_path: z.string().nullable(),
  output_dir: z.string().nullable(),
  pid: z.number().int().nullable(),
  phase: z.string().nullable(),
  progress_note: z.string().nullable(),
  last_tool: z.string().nullable(),
  cancel_requested_at: z.string().nullable(),
  heartbeat_at: z.string().nullable(),
  created_at: z.string(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
  updated_at: z.string(),
});
export type GenerationJob = z.infer<typeof GenerationJobSchema>;

export const EnqueueGenerationSchema = z.object({
  type: GenerationJobType,
  case_id: z.string().regex(CASE_ID_RE, "case_id must look like ci-xxxxxxxx"),
  board_item_id: z.string().regex(BOARD_ITEM_ID_RE, "board_item_id must look like bd-xxxxxxxx").optional(),
  force: z.boolean().optional(),
});
export type EnqueueGeneration = z.infer<typeof EnqueueGenerationSchema>;

/** Names of the events the worker appends and the server relays as `gen.<name>` over SSE. */
export const GenerationEventType = z.enum(["queued", "started", "progress", "done", "failed", "cancelled"]);
export type GenerationEventType = z.infer<typeof GenerationEventType>;

// ---------------------------------------------------------------- configuration (SPEC D.5)

/** Anything that would widen the sandbox. Checked on every token of `cli.extraArgs`. */
const FORBIDDEN_TOKEN = [/bypasspermissions/i, /dangerously/i, /\b(bash|powershell|pwsh)\b/i];
/** Flags the runner owns: permissions, tools, MCP wiring and the working directory scope. */
const OWNED_FLAGS = new Set([
  "--permission-mode", "--add-dir", "--mcp-config", "--strict-mcp-config", "--tools", "--allowedtools", "--disallowedtools",
  "--allowed-tools", "--disallowed-tools", "--restricted", "--settings", "--dangerously-skip-permissions", "--permission-prompts",
]);

export function extraArgsProblem(args: readonly string[]): string | null {
  if (args.length && !args[0]?.startsWith("--")) return `extraArgs must start with a --flag (got "${args[0]}")`;
  for (const a of args) {
    if (FORBIDDEN_TOKEN.some((re) => re.test(a))) return `extraArgs may not contain "${a}" (bypassPermissions, dangerous flags, Bash and PowerShell are refused)`;
    const flag = a.split("=")[0]?.toLowerCase() ?? "";
    if (a.startsWith("--") && OWNED_FLAGS.has(flag)) return `extraArgs may not set ${flag}: the runner owns permissions, tools and MCP`;
  }
  return null;
}

const perType = <T extends z.ZodTypeAny>(v: T) =>
  z.union([v, z.object({ visual_options: v.optional(), generate_video: v.optional() })]).nullable();

export const GenerationConfigSchema = z.object({
  enabled: z.boolean().default(true),
  worker: z.enum(["on", "off"]).default("on"),
  mode: z.enum(["live", "fake"]).default("live"),
  cli: z
    .object({
      kind: z.literal("claude").default("claude"),
      bin: z.string().min(1).nullable().default(null),
      extraArgs: z
        .array(z.string())
        .default([])
        .superRefine((a, ctx) => {
          const p = extraArgsProblem(a);
          if (p) ctx.addIssue({ code: "custom", message: p });
        }),
    })
    .default({}),
  /** Pinned by full id; verified with `claude -p --model <id>` (docs/specs/2026-10-03-app-refresh/T8-probe-results.md). */
  model: z.string().regex(MODEL_ID_RE, "model id has unexpected characters").default("sonnet"),
  fallbackModel: z.string().regex(MODEL_ID_RE).nullable().default(null),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]).nullable().default(null),
  /** never bypassPermissions: it is not in the enum, so config load refuses it */
  permissionMode: z.enum(["dontAsk", "acceptEdits", "manual", "plan", "auto"]).default("dontAsk"),
  web: z
    .object({
      search: z.boolean().default(true),
      fetch: z.boolean().default(true),
      fetchDomains: z.array(z.string().regex(DOMAIN_RE)).nullable().default(null),
      download: z
        .object({
          hosts: z.array(z.string().regex(DOMAIN_RE)).default(["upload.wikimedia.org", "commons.wikimedia.org"]),
          mime: z.array(z.string()).default(["image/png", "image/svg+xml", "image/webp"]),
          maxBytes: z.number().int().positive().default(5_000_000),
          maxPerJob: z.number().int().positive().default(40),
          licences: z.array(z.string()).default(["PD", "CC0", "CC-BY", "CC-BY-SA"]),
        })
        .default({}),
    })
    .default({}),
  /** Q7: no wall-clock limit by default. A number (minutes) or per job type. */
  timeoutMin: perType(z.number().positive()).default(null),
  /** Q7: no spend cap by default. A number (USD) or per job type; maps to --max-budget-usd. */
  budgetUsd: perType(z.number().positive()).default(null),
  maxAttempts: z.number().int().min(1).default(2),
});
export type GenerationConfig = z.infer<typeof GenerationConfigSchema>;

type PerType = number | { visual_options?: number | undefined; generate_video?: number | undefined } | null;
/** Resolve a number-or-per-type config value for one job type; null when unset. */
export function perTypeValue(v: PerType, type: GenerationJobType): number | null {
  if (v === null || v === undefined) return null;
  return typeof v === "number" ? v : (v[type] ?? null);
}
