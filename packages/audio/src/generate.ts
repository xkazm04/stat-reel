/**
 * The audio stage's generation paths: client + request-hash cache + budget + take acceptance.
 * Budget is reserved only inside `produce`, so cache hits and replay fixtures cost nothing.
 */
import { type AudioAssetSchema, type CharAlignment, PlanTier } from "@statreel/schemas";
import type { Budget, Reservation } from "./budget";
import { estimateTtsSeconds } from "./budget";
import { type AudioCache, type CacheEntry, canonicalJson, sha256 } from "./cache";
import { buildMusicRequest, buildTtsRequest, type ElevenLabsClient, type MusicParams, type TtsParams } from "./client";
import { ProviderError, TakeRejected } from "./errors";
import { acceptTake } from "./music";
import type { PlanTierValue } from "./plan-tier";

export type AudioAsset = ReturnType<typeof AudioAssetSchema.parse>;
/** An asset record; `plan_tier` stays absent when unknown so the publish gate denies it. */
export type DraftAudioAsset = Omit<AudioAsset, "plan_tier"> & { plan_tier?: AudioAsset["plan_tier"] };

export interface GenerateDeps {
  client: ElevenLabsClient;
  cache: AudioCache;
  budget: Budget;
  /** the tier in force NOW (`planTierFromSubscription(await client.subscription())`); stamped on what this run generates, never on cache hits */
  planTier?: PlanTierValue;
  /** injectable for tests; defaults to ffprobe */
  probeDurationS?: ((file: string) => Promise<number>) | undefined;
}

export interface TtsGeneration {
  key: string;
  source: CacheEntry["source"];
  audioPath: string;
  alignment: CharAlignment;
  normalizedAlignment?: CharAlignment;
  /** end time of the last aligned character */
  durationS: number;
  asset: DraftAudioAsset;
}

/**
 * `Budget.release` means "the provider produced nothing billable", and only an error status from
 * the provider proves that. A 200 whose body we then reject was generated (and billed); a network
 * failure or abort after the request left may have been. Those keep the reservation (fail closed).
 */
function settleOrRelease(budget: Budget, r: Reservation, e: unknown) {
  if (e instanceof ProviderError && e.httpStatus >= 400) budget.release(r);
  else budget.settle(r, r.seconds);
}

/**
 * The plan tier an asset was GENERATED under, from its cache record - never today's tier: a
 * commercial grant is not retroactive, so a free-plan take served from cache after an upgrade
 * stays free. An entry with no recorded tier gets none, and the publish gate denies it.
 */
function generatedPlanTier(entry: CacheEntry): AudioAsset["plan_tier"] | undefined {
  const t = PlanTier.safeParse(entry.meta.plan_tier);
  return t.success ? t.data : undefined;
}

const alignmentEndS = (a: CharAlignment) => a.character_end_times_seconds.reduce((m, x) => Math.max(m, x), 0);

export async function generateTts(
  deps: GenerateDeps,
  params: TtsParams & { sceneId?: string },
): Promise<TtsGeneration> {
  const { sceneId, ...tts } = params;
  const request = buildTtsRequest(tts);
  const entry = await deps.cache.getOrCreate("tts", request, async () => {
    const r = deps.budget.reserve("tts", estimateTtsSeconds(tts.text));
    try {
      const out = await deps.client.ttsWithTimestamps(tts);
      deps.budget.settle(r, alignmentEndS(out.alignment));
      return { ...out, model: tts.modelId, ...(deps.planTier ? { planTier: deps.planTier } : {}) };
    } catch (e) {
      settleOrRelease(deps.budget, r, e);
      throw e;
    }
  });
  const alignment = entry.meta.alignment;
  if (!alignment) throw new Error(`cached tts ${entry.key} has no alignment`);
  const asset: DraftAudioAsset = {
    kind: "tts",
    provider: "elevenlabs",
    request_id: entry.meta.request_id,
    model_id: tts.modelId,
    voice_id: tts.voiceId,
    generated_at: entry.meta.generated_at,
    sha256: entry.meta.sha256,
    scene_id: sceneId ?? null,
    c2pa: "unknown",
  };
  const tier = generatedPlanTier(entry);
  if (tier) asset.plan_tier = tier;
  const out: TtsGeneration = {
    key: entry.key,
    source: entry.source,
    audioPath: entry.audioPath,
    alignment,
    durationS: alignmentEndS(alignment),
    asset,
  };
  if (entry.meta.normalized_alignment) out.normalizedAlignment = entry.meta.normalized_alignment;
  return out;
}

export interface MusicGeneration {
  key: string;
  source: CacheEntry["source"];
  audioPath: string;
  take: number;
  durationMs: number;
  rejected: TakeRejected[];
  asset: DraftAudioAsset;
}

/**
 * Generate a cue at its exact length. An off-length take is rejected (never stretched) and the
 * next take is tried, up to `maxTakes` (default 2). Takes are cached individually (`take` is part
 * of the cache key, never sent), so a rerun reproduces the same decisions for free.
 */
export async function generateMusic(
  deps: GenerateDeps,
  params: MusicParams & { maxTakes?: number },
): Promise<MusicGeneration> {
  const { maxTakes = 2, ...music } = params;
  const base = buildMusicRequest(music as MusicParams);
  const rejected: TakeRejected[] = [];
  for (let take = 1; take <= maxTakes; take++) {
    const request = take === 1 ? base : { ...base, take };
    const entry = await deps.cache.getOrCreate("music", request, async () => {
      const r = deps.budget.reserve("music", music.musicLengthMs / 1000);
      try {
        const out = await deps.client.composeMusic(music as MusicParams);
        deps.budget.settle(r, music.musicLengthMs / 1000);
        return {
          ...out,
          model: String(base.body?.model_id),
          ...(deps.planTier ? { planTier: deps.planTier } : {}),
        };
      } catch (e) {
        settleOrRelease(deps.budget, r, e);
        throw e;
      }
    });
    try {
      const { durationMs } = await acceptTake(
        entry.audioPath,
        music.musicLengthMs,
        deps.probeDurationS ? { probe: deps.probeDurationS } : {},
      );
      const asset: DraftAudioAsset = {
        kind: "music",
        provider: "elevenlabs",
        request_id: entry.meta.request_id,
        model_id: String(base.body?.model_id),
        prompt_sha256: sha256(canonicalJson(music.prompt ?? music.compositionPlan)),
        generated_at: entry.meta.generated_at,
        sha256: entry.meta.sha256,
        c2pa: "unknown",
      };
      const tier = generatedPlanTier(entry);
      if (tier) asset.plan_tier = tier;
      return { key: entry.key, source: entry.source, audioPath: entry.audioPath, take, durationMs, rejected, asset };
    } catch (e) {
      if (!(e instanceof TakeRejected)) throw e;
      rejected.push(e);
    }
  }
  throw rejected.at(-1) ?? new Error("maxTakes must be ≥ 1");
}
