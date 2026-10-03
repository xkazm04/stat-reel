/**
 * Minimal ElevenLabs HTTP client (global fetch). Request/response fields relied on are listed in
 * `packages/audio/API-NOTES.md` with the doc URL and the date they were checked.
 *
 * The API key is fetched lazily per request (keychain), sent only as the `xi-api-key` header, and
 * never appears in request objects, cache keys or error messages.
 */
import type { CharAlignment } from "@statreel/schemas";
import { AudioRefused, AuthError, InvalidMusicRequest, ProviderError, type ProviderErrorInit, QuotaError } from "./errors";

export const DEFAULT_BASE_URL = "https://api.elevenlabs.io";
export const DEFAULT_OUTPUT_FORMAT = "mp3_44100_128";
export const DEFAULT_MUSIC_MODEL = "music_v2";
export const MUSIC_MIN_MS = 3000;
export const MUSIC_MAX_MS = 600_000;
/** per-section duration limits of a composition plan (API-NOTES.md, Music compose) */
export const MUSIC_SECTION_MIN_MS = 3000;
export const MUSIC_SECTION_MAX_MS = 120_000;
const SECTION_NAME_MAX = 100;
const VOCAL_STYLE = /vocal|lyric|sing/i;
const MAX_RETRIES_429 = 3;

export interface VoiceSettings {
  stability?: number;
  similarity_boost?: number;
  style?: number;
  use_speaker_boost?: boolean;
  speed?: number;
}

export interface TtsParams {
  voiceId: string;
  text: string;
  modelId: string;
  voiceSettings?: VoiceSettings;
  seed?: number;
  languageCode?: string;
  outputFormat?: string;
}

export interface TtsResult {
  audio: Buffer;
  alignment: CharAlignment;
  normalizedAlignment?: CharAlignment;
  requestId?: string;
}

export interface MusicSection {
  section_name: string;
  positive_local_styles: string[];
  negative_local_styles: string[];
  duration_ms: number;
  lines: string[];
}

export interface CompositionPlan {
  positive_global_styles: string[];
  negative_global_styles: string[];
  sections: MusicSection[];
}

interface MusicCommon {
  /** the exact length the cue needs; a plan's sections must sum to it */
  musicLengthMs: number;
  /** StatReel only ever generates instrumental beds */
  forceInstrumental: true;
  modelId?: string;
  outputFormat?: string;
}
export type MusicParams =
  | (MusicCommon & { prompt: string; compositionPlan?: undefined })
  | (MusicCommon & { compositionPlan: CompositionPlan; prompt?: undefined });

export interface MusicResult {
  audio: Buffer;
  requestId?: string;
}

export interface ForcedAlignmentResult {
  characters: { text: string; start: number; end: number }[];
  words: { text: string; start: number; end: number; loss: number }[];
  loss: number;
  /** the same characters in the /with-timestamps shape */
  alignment: CharAlignment;
}

export interface Subscription {
  tier: string;
  characterCount: number;
  characterLimit: number;
  status?: string;
  nextCharacterCountResetUnix?: number;
}

/** What gets sent (minus the key). Also the input to the cache key. */
export interface ProviderRequest {
  method: "POST" | "GET";
  endpoint: string;
  body?: Record<string, unknown>;
}

export function buildTtsRequest(p: TtsParams): ProviderRequest {
  const body: Record<string, unknown> = { text: p.text, model_id: p.modelId };
  if (p.voiceSettings) body.voice_settings = p.voiceSettings;
  if (p.seed !== undefined) body.seed = p.seed;
  if (p.languageCode !== undefined) body.language_code = p.languageCode;
  const format = encodeURIComponent(p.outputFormat ?? DEFAULT_OUTPUT_FORMAT);
  return {
    method: "POST",
    endpoint: `/v1/text-to-speech/${encodeURIComponent(p.voiceId)}/with-timestamps?output_format=${format}`,
    body,
  };
}

export function buildMusicRequest(p: MusicParams): ProviderRequest {
  const len = p.musicLengthMs;
  if (!Number.isInteger(len) || len < MUSIC_MIN_MS || len > MUSIC_MAX_MS)
    throw new RangeError(`musicLengthMs must be an integer in ${MUSIC_MIN_MS}-${MUSIC_MAX_MS}, got ${len}`);
  if (p.forceInstrumental !== true) throw new Error("music must be instrumental (forceInstrumental: true)");
  const model_id = p.modelId ?? DEFAULT_MUSIC_MODEL;
  const format = encodeURIComponent(p.outputFormat ?? DEFAULT_OUTPUT_FORMAT);
  const endpoint = `/v1/music?output_format=${format}`;
  if (p.compositionPlan !== undefined) {
    if (p.prompt !== undefined) throw new Error("prompt and compositionPlan are mutually exclusive");
    const plan = p.compositionPlan;
    for (const [i, s] of plan.sections.entries()) {
      const where = `compositionPlan.sections[${i}]`;
      if (!Number.isInteger(s.duration_ms) || s.duration_ms < MUSIC_SECTION_MIN_MS || s.duration_ms > MUSIC_SECTION_MAX_MS)
        throw new InvalidMusicRequest(
          `${where}.duration_ms`,
          `section '${s.section_name}' is ${s.duration_ms} ms; the API accepts whole milliseconds from ${MUSIC_SECTION_MIN_MS} to ${MUSIC_SECTION_MAX_MS}. Merge short sections or split long ones`,
        );
      if (s.section_name.length < 1 || s.section_name.length > SECTION_NAME_MAX)
        throw new InvalidMusicRequest(`${where}.section_name`, `must be 1-${SECTION_NAME_MAX} characters`);
    }
    const sum = plan.sections.reduce((s, x) => s + x.duration_ms, 0);
    if (sum !== len) throw new Error(`composition plan sections sum to ${sum} ms, expected musicLengthMs ${len}`);
    if (plan.sections.some((s) => s.lines.length > 0))
      throw new Error("composition plan must be instrumental: sections may not carry lines");
    // the API documents music_length_ms / force_instrumental as prompt-only; a plan sets length via sections.
    // Instrumental then rests on empty `lines`, backed by the documented negative_global_styles list.
    const negative = plan.negative_global_styles.some((x) => VOCAL_STYLE.test(x))
      ? plan.negative_global_styles
      : [...plan.negative_global_styles, "vocals"];
    return {
      method: "POST",
      endpoint,
      body: { composition_plan: { ...plan, negative_global_styles: negative }, model_id },
    };
  }
  if (typeof p.prompt !== "string" || p.prompt.trim() === "") throw new Error("music prompt must be non-empty");
  return {
    method: "POST",
    endpoint,
    body: { prompt: p.prompt, music_length_ms: len, force_instrumental: true, model_id },
  };
}

export interface ElevenLabsClientOptions {
  apiKey: () => Promise<string>;
  fetch?: typeof fetch;
  baseUrl?: string;
  /** injectable for tests */
  sleep?: (ms: number) => Promise<void>;
  /** first 429 backoff in ms, doubled per retry (default 1000) */
  retryBaseMs?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const POLICY_REASON =
  /moderat|content[_ ]?polic|policy[_ ]?violation|safety|guideline|terms[_ ]of[_ ](service|use)|copyright|bad_prompt|bad_composition_plan|prohibited|flagged|blocked_content|violat/i;
const QUOTA_REASON = /quota_exceeded|insufficient_credits|quota|credits/i;

interface ParsedError {
  code?: string;
  message: string;
  requestId?: string;
  suggestion?: string;
  reasonText: string;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

function parseErrorBody(text: string): ParsedError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { message: text.slice(0, 500) || "(empty body)", reasonText: text.slice(0, 500) };
  }
  const detail = (parsed as { detail?: unknown } | null)?.detail;
  if (Array.isArray(detail)) {
    const message = detail
      .map((d) => {
        const o = d as { loc?: unknown[]; msg?: unknown };
        return `${Array.isArray(o.loc) ? o.loc.join(".") : ""}: ${String(o.msg ?? JSON.stringify(d))}`;
      })
      .join("; ");
    return { message, reasonText: message };
  }
  if (typeof detail === "string") return { message: detail, reasonText: detail };
  if (detail && typeof detail === "object") {
    const d = detail as Record<string, unknown>;
    const data = (d.data ?? {}) as Record<string, unknown>;
    const code = str(d.code) ?? str(d.status);
    const message = str(d.message) ?? JSON.stringify(d).slice(0, 500);
    const suggestion =
      str(data.prompt_suggestion) ?? str(d.prompt_suggestion) ?? str(data.composition_plan_suggestion) ?? undefined;
    const reasonText = [d.type, d.code, d.status, d.message].filter((x) => typeof x === "string").join(" ");
    const out: ParsedError = { message, reasonText };
    if (code) out.code = code;
    const rid = str(d.request_id);
    if (rid) out.requestId = rid;
    if (suggestion) out.suggestion = suggestion;
    return out;
  }
  return { message: text.slice(0, 500), reasonText: text.slice(0, 500) };
}

function mapError(
  status: number,
  parsed: ParsedError,
  headerRequestId: string | undefined,
  what: string,
): ProviderError {
  const init: ProviderErrorInit = {
    httpStatus: status,
    code: parsed.code,
    providerMessage: parsed.message,
    requestId: parsed.requestId ?? headerRequestId,
  };
  const msg = `ElevenLabs ${what} failed (HTTP ${status}${parsed.code ? ` ${parsed.code}` : ""}): ${parsed.message}`;
  if (status === 402 || (status >= 400 && status < 500 && QUOTA_REASON.test(parsed.code ?? "")))
    return new QuotaError(msg, init);
  if (status === 401) return new AuthError(msg, init);
  if (status >= 400 && status < 500 && status !== 429 && POLICY_REASON.test(parsed.reasonText))
    return new AudioRefused(`ElevenLabs refused ${what}: ${parsed.message}`, {
      ...init,
      suggestion: parsed.suggestion,
    });
  return new ProviderError(msg, init);
}

export class ElevenLabsClient {
  private readonly apiKey: () => Promise<string>;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly retryBaseMs: number;

  constructor(opts: ElevenLabsClientOptions) {
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.sleep = opts.sleep ?? defaultSleep;
    this.retryBaseMs = opts.retryBaseMs ?? 1000;
  }

  async ttsWithTimestamps(p: TtsParams): Promise<TtsResult> {
    const req = buildTtsRequest(p);
    const res = await this.send(req, "text-to-speech");
    const json = (await res.json()) as {
      audio_base64?: unknown;
      alignment?: CharAlignment | null;
      normalized_alignment?: CharAlignment | null;
    };
    const requestId = res.headers.get("request-id") ?? undefined;
    if (typeof json.audio_base64 !== "string" || json.audio_base64 === "")
      throw new ProviderError("ElevenLabs text-to-speech returned no audio_base64", {
        httpStatus: res.status,
        requestId,
      });
    if (!isAlignment(json.alignment))
      throw new ProviderError("ElevenLabs text-to-speech returned no character alignment", {
        httpStatus: res.status,
        requestId,
      });
    const out: TtsResult = { audio: Buffer.from(json.audio_base64, "base64"), alignment: json.alignment };
    if (isAlignment(json.normalized_alignment)) out.normalizedAlignment = json.normalized_alignment;
    if (requestId) out.requestId = requestId;
    return out;
  }

  async composeMusic(p: MusicParams): Promise<MusicResult> {
    const req = buildMusicRequest(p);
    const res = await this.send(req, "music compose");
    const audio = Buffer.from(await res.arrayBuffer());
    if (audio.length === 0)
      throw new ProviderError("ElevenLabs music compose returned an empty body", { httpStatus: res.status });
    const requestId = res.headers.get("request-id") ?? undefined;
    return requestId ? { audio, requestId } : { audio };
  }

  async forcedAlignment(audio: Buffer, text: string, filename = "audio.mp3"): Promise<ForcedAlignmentResult> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(audio)], { type: "audio/mpeg" }), filename);
    form.append("text", text);
    const res = await this.send({ method: "POST", endpoint: "/v1/forced-alignment" }, "forced alignment", form);
    const json = (await res.json()) as Omit<ForcedAlignmentResult, "alignment">;
    if (!Array.isArray(json.characters) || !Array.isArray(json.words))
      throw new ProviderError("ElevenLabs forced alignment returned no characters/words", { httpStatus: res.status });
    return {
      characters: json.characters,
      words: json.words,
      loss: json.loss,
      alignment: {
        characters: json.characters.map((c) => c.text),
        character_start_times_seconds: json.characters.map((c) => c.start),
        character_end_times_seconds: json.characters.map((c) => c.end),
      },
    };
  }

  async subscription(): Promise<Subscription> {
    const res = await this.send({ method: "GET", endpoint: "/v1/user/subscription" }, "subscription");
    const j = (await res.json()) as Record<string, unknown>;
    if (typeof j.tier !== "string")
      throw new ProviderError("ElevenLabs subscription has no tier", { httpStatus: res.status });
    const out: Subscription = {
      tier: j.tier,
      characterCount: Number(j.character_count),
      characterLimit: Number(j.character_limit),
    };
    if (typeof j.status === "string") out.status = j.status;
    if (typeof j.next_character_count_reset_unix === "number")
      out.nextCharacterCountResetUnix = j.next_character_count_reset_unix;
    return out;
  }

  /** Sends a request; retries 429 up to 3 times with exponential backoff (or Retry-After). */
  private async send(req: ProviderRequest, what: string, form?: FormData): Promise<Response> {
    const url = `${this.baseUrl}${req.endpoint}`;
    for (let attempt = 0; ; attempt++) {
      const headers: Record<string, string> = { "xi-api-key": await this.apiKey(), accept: "*/*" };
      let body: BodyInit | undefined;
      if (form) body = form;
      else if (req.body) {
        headers["content-type"] = "application/json";
        body = JSON.stringify(req.body);
      }
      let res: Response;
      try {
        res = await this.fetchImpl(
          url,
          body === undefined ? { method: req.method, headers } : { method: req.method, headers, body },
        );
      } catch (e) {
        throw new ProviderError(`ElevenLabs ${what} request failed: ${(e as Error).message}`, { httpStatus: 0 });
      }
      if (res.ok) return res;
      const headerRequestId = res.headers.get("request-id") ?? undefined;
      const parsed = parseErrorBody(await res.text().catch(() => ""));
      if (res.status === 429 && attempt < MAX_RETRIES_429) {
        await this.sleep(retryDelayMs(res.headers.get("retry-after"), this.retryBaseMs, attempt));
        continue;
      }
      throw mapError(res.status, parsed, headerRequestId, what);
    }
  }
}

function retryDelayMs(retryAfter: string | null, baseMs: number, attempt: number): number {
  if (retryAfter !== null) {
    const s = Number(retryAfter);
    if (Number.isFinite(s) && s >= 0) return Math.min(s * 1000, 60_000);
    const at = Date.parse(retryAfter);
    if (!Number.isNaN(at)) return Math.min(Math.max(0, at - Date.now()), 60_000);
  }
  return baseMs * 2 ** attempt;
}

function isAlignment(a: unknown): a is CharAlignment {
  if (!a || typeof a !== "object") return false;
  const o = a as Record<string, unknown>;
  return (
    Array.isArray(o.characters) &&
    Array.isArray(o.character_start_times_seconds) &&
    Array.isArray(o.character_end_times_seconds) &&
    o.characters.length === o.character_start_times_seconds.length &&
    o.characters.length === o.character_end_times_seconds.length
  );
}
