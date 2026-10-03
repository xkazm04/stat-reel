/**
 * Co-pilot session caps and the stop messages that explain them (DESIGN §6.6). No fs, no spawn.
 *
 * `claude --help` (2.1.288, 2026-10-03) has `--max-budget-usd <amount>` ("only works with --print")
 * but NO `--max-turns`, so the budget cap is a CLI flag while the turn cap and the wall-clock cap
 * are enforced by the caller through an AbortSignal (see LlmService). Defaults are generous against
 * the one recorded run (9 turns, $0.35, ~70 s) and bound a runaway loop.
 */
export type LlmLimits = { maxTurns: number; maxBudgetUsd: number; timeoutMs: number };

export const DEFAULT_LLM_LIMITS: LlmLimits = { maxTurns: 40, maxBudgetUsd: 3, timeoutMs: 15 * 60_000 };

const positive = (raw: string | undefined, fallback: number): number => {
  const n = Number(raw);
  return raw !== undefined && raw.trim() !== "" && Number.isFinite(n) && n > 0 ? n : fallback;
};

/** Env overrides: LLM_MAX_TURNS, LLM_MAX_BUDGET_USD, LLM_TIMEOUT_MS. Invalid values fall back to the default. */
export function llmLimitsFromEnv(env: Record<string, string | undefined> = process.env): LlmLimits {
  return {
    maxTurns: Math.floor(positive(env.LLM_MAX_TURNS, DEFAULT_LLM_LIMITS.maxTurns)),
    maxBudgetUsd: positive(env.LLM_MAX_BUDGET_USD, DEFAULT_LLM_LIMITS.maxBudgetUsd),
    timeoutMs: Math.floor(positive(env.LLM_TIMEOUT_MS, DEFAULT_LLM_LIMITS.timeoutMs)),
  };
}

export type StopReason = "max_turns" | "max_budget" | "timeout";

/** Actionable message for a stop: says what stopped it and what the owner can do next. */
export function stopMessage(reason: StopReason, limits: LlmLimits, turns?: number): string {
  switch (reason) {
    case "max_turns":
      return `Co-pilot stopped at ${turns ?? limits.maxTurns} turns (limit ${limits.maxTurns}) - send a follow-up to continue the session and go further, or raise LLM_MAX_TURNS.`;
    case "max_budget":
      return `Co-pilot stopped at its $${limits.maxBudgetUsd} budget cap - send a follow-up to continue the session, or raise LLM_MAX_BUDGET_USD.`;
    case "timeout":
      return `Co-pilot stopped after ${Math.round(limits.timeoutMs / 1000)} s of wall-clock time - send a follow-up to continue the session, or raise LLM_TIMEOUT_MS.`;
  }
}

/** Maps the CLI's result subtype (`error_max_turns`, `error_max_budget_usd`) to a StopReason. */
export function stopReasonFromSubtype(subtype: string | undefined): StopReason | undefined {
  if (subtype === "error_max_turns") return "max_turns";
  if (subtype === "error_max_budget_usd") return "max_budget";
  return undefined;
}
