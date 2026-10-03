/**
 * Typed errors for the audio stage. A refusal (provider policy, budget) is a labelled state,
 * never an empty success (ADR 003, `_laws.md#refusal-is-a-state`): `state` tells the job runner
 * which JobStatus to record.
 */
import type { JobStatus } from "@statreel/schemas";

export type AudioErrorState = "refused" | "failed";

export abstract class AudioError extends Error {
  abstract readonly state: AudioErrorState;
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export interface ProviderErrorInit {
  httpStatus: number;
  code?: string | undefined;
  providerMessage?: string | undefined;
  requestId?: string | undefined;
}

/** Any provider failure that is not auth, quota or a policy refusal. */
export class ProviderError extends AudioError {
  readonly state: AudioErrorState = "failed";
  readonly httpStatus: number;
  readonly code: string | undefined;
  readonly providerMessage: string | undefined;
  readonly requestId: string | undefined;
  constructor(message: string, init: ProviderErrorInit) {
    super(message);
    this.httpStatus = init.httpStatus;
    this.code = init.code;
    this.providerMessage = init.providerMessage;
    this.requestId = init.requestId;
  }
}

/** 401: missing or invalid API key. */
export class AuthError extends ProviderError {}

/** 402 or a quota/credits code: the account cannot pay for this generation. */
export class QuotaError extends ProviderError {}

/** The provider declined on content/policy/moderation grounds. Carries its message verbatim. */
export class AudioRefused extends ProviderError {
  override readonly state: AudioErrorState = "refused";
  /** e.g. ElevenLabs Music `prompt_suggestion`, when the provider offers one */
  readonly suggestion: string | undefined;
  constructor(message: string, init: ProviderErrorInit & { suggestion?: string | undefined }) {
    super(message, init);
    this.suggestion = init.suggestion;
  }
}

/** The per-run generation budget (DESIGN §6.4) would be exceeded. A refusal, not a failure. */
export class BudgetExceeded extends AudioError {
  readonly state: AudioErrorState = "refused";
  constructor(
    readonly kind: "tts" | "music",
    readonly requestedS: number,
    readonly usedS: number,
    readonly limitS: number,
  ) {
    super(
      `${kind} budget exceeded: requested ${requestedS.toFixed(2)} s with ${usedS.toFixed(2)} of ${limitS} s used (DESIGN §6.4 live test budget)`,
    );
  }
}

/** Replay mode found no recorded fixture for this request. */
export class FixtureMissing extends AudioError {
  readonly state: AudioErrorState = "failed";
  readonly hint: string;
  constructor(
    readonly kind: string,
    readonly key: string,
    readonly fixturesDir: string,
  ) {
    const hint = `record it with AUDIO_MODE=live AUDIO_RECORD=1 (spends ElevenLabs credits within the §6.4 budget), or revert the request change`;
    super(`no ${kind} audio fixture for request ${key} in ${fixturesDir}; ${hint}`);
    this.hint = hint;
  }
}

/** A cached/fixture file failed its integrity check. */
export class CacheCorrupt extends AudioError {
  readonly state: AudioErrorState = "failed";
}

/** A generated take is off-length; it is rejected, never stretched. */
export class TakeRejected extends AudioError {
  readonly state: AudioErrorState = "failed";
  constructor(
    readonly file: string,
    readonly expectedMs: number,
    readonly actualMs: number,
    readonly toleranceMs: number,
  ) {
    super(
      `take ${file} is ${actualMs.toFixed(0)} ms, expected ${expectedMs} ms ±${toleranceMs} ms: rejected (never stretched)`,
    );
  }
}

/**
 * A music request that the API would reject (documented limits) caught before any paid call.
 * `failed`, never `refused`: the plan is ours to fix; `fix` says what to change.
 */
export class InvalidMusicRequest extends AudioError {
  readonly state: AudioErrorState = "failed";
  constructor(
    readonly field: string,
    readonly fix: string,
  ) {
    super(`invalid music request (${field}): ${fix}. No ElevenLabs call was made.`);
  }
}

export class UnknownPlanTier extends AudioError {
  readonly state: AudioErrorState = "failed";
  constructor(readonly tier: string) {
    super(`unknown ElevenLabs subscription tier '${tier}'; add an explicit mapping instead of guessing`);
  }
}

/** Map any error thrown by this package to the job status the runner should record. */
export function jobStatusFor(err: unknown): JobStatus {
  return err instanceof AudioError && err.state === "refused" ? "refused" : "failed";
}
