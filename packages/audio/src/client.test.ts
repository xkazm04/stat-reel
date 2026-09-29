import { describe, expect, it, vi } from "vitest";
import { buildMusicRequest, buildTtsRequest, ElevenLabsClient } from "./client";
import { AudioRefused, AuthError, jobStatusFor, ProviderError, QuotaError } from "./errors";

const KEY = "sk-test-secret";

type Call = { url: string; init: RequestInit };

function mockFetch(responses: Array<Response | (() => Response)>) {
  const calls: Call[] = [];
  let i = 0;
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    if (!r) throw new Error("no mock response");
    return typeof r === "function" ? r() : r;
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const alignment = {
  characters: ["H", "i", "."],
  character_start_times_seconds: [0, 0.1, 0.2],
  character_end_times_seconds: [0.1, 0.2, 0.35],
};

function client(fetchImpl: typeof fetch, sleep = vi.fn(async (_ms: number) => {})) {
  return {
    sleep,
    c: new ElevenLabsClient({ apiKey: async () => KEY, fetch: fetchImpl, sleep, retryBaseMs: 10 }),
  };
}

describe("request builders", () => {
  it("tts request has endpoint + body and never the key", () => {
    const r = buildTtsRequest({ voiceId: "v1", text: "Hi.", modelId: "eleven_multilingual_v2", seed: 7 });
    expect(r.method).toBe("POST");
    expect(r.endpoint).toBe("/v1/text-to-speech/v1/with-timestamps?output_format=mp3_44100_128");
    expect(r.body).toEqual({ text: "Hi.", model_id: "eleven_multilingual_v2", seed: 7 });
    expect(JSON.stringify(r)).not.toContain(KEY);
  });

  it("music prompt request forces instrumental and exact length", () => {
    const r = buildMusicRequest({ prompt: "tense synth bed", musicLengthMs: 12_345, forceInstrumental: true });
    expect(r.endpoint).toBe("/v1/music?output_format=mp3_44100_128");
    expect(r.body).toEqual({
      prompt: "tense synth bed",
      music_length_ms: 12_345,
      force_instrumental: true,
      model_id: "music_v2",
    });
  });

  it("music composition plan must sum to the requested length and carry no lyrics", () => {
    const plan = {
      positive_global_styles: ["ambient"],
      negative_global_styles: ["vocals"],
      sections: [
        { section_name: "a", positive_local_styles: [], negative_local_styles: [], duration_ms: 4000, lines: [] },
        { section_name: "b", positive_local_styles: [], negative_local_styles: [], duration_ms: 6000, lines: [] },
      ],
    };
    const r = buildMusicRequest({ compositionPlan: plan, musicLengthMs: 10_000, forceInstrumental: true });
    expect(r.body).toEqual({ composition_plan: plan, model_id: "music_v2" });
    expect(() => buildMusicRequest({ compositionPlan: plan, musicLengthMs: 9_000, forceInstrumental: true })).toThrow(
      /sum/,
    );
    const lyrical = { ...plan, sections: [{ ...plan.sections[0], duration_ms: 10_000, lines: ["la la"] }] };
    expect(() =>
      buildMusicRequest({ compositionPlan: lyrical as typeof plan, musicLengthMs: 10_000, forceInstrumental: true }),
    ).toThrow(/instrumental/);
  });

  it("music length is bounded to 3000-600000 ms", () => {
    expect(() => buildMusicRequest({ prompt: "x", musicLengthMs: 2999, forceInstrumental: true })).toThrow(RangeError);
    expect(() => buildMusicRequest({ prompt: "x", musicLengthMs: 600_001, forceInstrumental: true })).toThrow(
      RangeError,
    );
    expect(() => buildMusicRequest({ prompt: "x", musicLengthMs: 3000.5, forceInstrumental: true })).toThrow(
      RangeError,
    );
  });
});

describe("ElevenLabsClient", () => {
  it("ttsWithTimestamps posts JSON with xi-api-key and decodes audio + alignment", async () => {
    const audio = Buffer.from("fake-mp3-bytes");
    const { fetch, calls } = mockFetch([
      json(
        200,
        { audio_base64: audio.toString("base64"), alignment, normalized_alignment: alignment },
        { "request-id": "req-1" },
      ),
    ]);
    const { c } = client(fetch);
    const out = await c.ttsWithTimestamps({
      voiceId: "voiceA",
      text: "Hi.",
      modelId: "eleven_multilingual_v2",
      voiceSettings: { stability: 0.5, similarity_boost: 0.75 },
    });
    expect(out.audio.equals(audio)).toBe(true);
    expect(out.alignment).toEqual(alignment);
    expect(out.normalizedAlignment).toEqual(alignment);
    expect(out.requestId).toBe("req-1");
    const call = calls[0];
    expect(call?.url).toBe(
      "https://api.elevenlabs.io/v1/text-to-speech/voiceA/with-timestamps?output_format=mp3_44100_128",
    );
    expect(call?.init.method).toBe("POST");
    const headers = new Headers(call?.init.headers);
    expect(headers.get("xi-api-key")).toBe(KEY);
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(String(call?.init.body))).toEqual({
      text: "Hi.",
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    });
  });

  it("tts without alignment is a provider error, not an empty success", async () => {
    const { fetch } = mockFetch([json(200, { audio_base64: "AAAA", alignment: null })]);
    await expect(client(fetch).c.ttsWithTimestamps({ voiceId: "v", text: "x", modelId: "m" })).rejects.toBeInstanceOf(
      ProviderError,
    );
  });

  it("composeMusic returns the binary body", async () => {
    const bytes = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
    const { fetch, calls } = mockFetch([
      new Response(bytes, { status: 200, headers: { "content-type": "audio/mpeg", "request-id": "m-1" } }),
    ]);
    const out = await client(fetch).c.composeMusic({ prompt: "bed", musicLengthMs: 5000, forceInstrumental: true });
    expect(out.audio.equals(bytes)).toBe(true);
    expect(out.requestId).toBe("m-1");
    expect(calls[0]?.url).toBe("https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128");
  });

  it("forcedAlignment sends multipart file + text and converts to CharAlignment", async () => {
    const { fetch, calls } = mockFetch([
      json(200, {
        characters: [
          { text: "H", start: 0, end: 0.1 },
          { text: "i", start: 0.1, end: 0.2 },
        ],
        words: [{ text: "Hi", start: 0, end: 0.2, loss: 0.1 }],
        loss: 0.1,
      }),
    ]);
    const out = await client(fetch).c.forcedAlignment(Buffer.from("mp3"), "Hi");
    expect(out.words).toEqual([{ text: "Hi", start: 0, end: 0.2, loss: 0.1 }]);
    expect(out.alignment).toEqual({
      characters: ["H", "i"],
      character_start_times_seconds: [0, 0.1],
      character_end_times_seconds: [0.1, 0.2],
    });
    const body = calls[0]?.init.body;
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get("text")).toBe("Hi");
    expect((body as FormData).get("file")).toBeInstanceOf(Blob);
    expect(calls[0]?.url).toBe("https://api.elevenlabs.io/v1/forced-alignment");
  });

  it("subscription maps tier and character counts", async () => {
    const { fetch, calls } = mockFetch([
      json(200, { tier: "creator", character_count: 1200, character_limit: 100000, status: "active" }),
    ]);
    const out = await client(fetch).c.subscription();
    expect(out).toMatchObject({ tier: "creator", characterCount: 1200, characterLimit: 100000, status: "active" });
    expect(calls[0]?.init.method).toBe("GET");
    expect(calls[0]?.url).toBe("https://api.elevenlabs.io/v1/user/subscription");
  });

  it("honours a custom baseUrl", async () => {
    const { fetch, calls } = mockFetch([json(200, { tier: "free", character_count: 0, character_limit: 10 })]);
    const c = new ElevenLabsClient({ apiKey: async () => KEY, fetch, baseUrl: "http://localhost:9999/" });
    await c.subscription();
    expect(calls[0]?.url).toBe("http://localhost:9999/v1/user/subscription");
  });
});

describe("error mapping", () => {
  const tts = (c: ElevenLabsClient) => c.ttsWithTimestamps({ voiceId: "v", text: "x", modelId: "m" });

  it("401 -> AuthError (and the key never leaks into the message)", async () => {
    const { fetch } = mockFetch([
      json(401, { detail: { type: "authentication_error", code: "invalid_api_key", message: "Invalid API key" } }),
    ]);
    const err = await tts(client(fetch).c).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect(String((err as Error).message)).not.toContain(KEY);
    expect(jobStatusFor(err)).toBe("failed");
  });

  it("402 -> QuotaError", async () => {
    const { fetch } = mockFetch([
      json(402, { detail: { code: "insufficient_credits", message: "Not enough credits" } }),
    ]);
    await expect(tts(client(fetch).c)).rejects.toBeInstanceOf(QuotaError);
  });

  it("legacy 401 quota_exceeded -> QuotaError", async () => {
    const { fetch } = mockFetch([
      json(401, { detail: { status: "quota_exceeded", message: "This request exceeds your quota" } }),
    ]);
    await expect(tts(client(fetch).c)).rejects.toBeInstanceOf(QuotaError);
  });

  it("4xx with a content-policy reason -> AudioRefused, a labelled refusal carrying the provider message", async () => {
    const { fetch } = mockFetch([
      json(400, {
        detail: {
          status: "bad_prompt",
          message: "Prompt references copyrighted material",
          data: { prompt_suggestion: "an upbeat electronic track" },
        },
      }),
    ]);
    const err = await client(fetch)
      .c.composeMusic({ prompt: "in the style of X", musicLengthMs: 5000, forceInstrumental: true })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AudioRefused);
    const refused = err as AudioRefused;
    expect(refused.state).toBe("refused");
    expect(refused.providerMessage).toBe("Prompt references copyrighted material");
    expect(refused.suggestion).toBe("an upbeat electronic track");
    expect(refused.httpStatus).toBe(400);
    expect(jobStatusFor(err)).toBe("refused");
  });

  it("403 moderation -> AudioRefused", async () => {
    const { fetch } = mockFetch([
      json(403, { detail: { code: "content_moderation", message: "flagged by moderation" } }),
    ]);
    await expect(tts(client(fetch).c)).rejects.toBeInstanceOf(AudioRefused);
  });

  it("plain 4xx without a policy reason -> ProviderError (not a refusal)", async () => {
    const { fetch } = mockFetch([json(400, { detail: { code: "invalid_content_type", message: "bad content type" } })]);
    const err = await tts(client(fetch).c).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).not.toBeInstanceOf(AudioRefused);
    expect((err as ProviderError).httpStatus).toBe(400);
    expect((err as ProviderError).code).toBe("invalid_content_type");
  });

  it("422 validation array -> ProviderError with the detail text", async () => {
    const { fetch } = mockFetch([
      json(422, { detail: [{ loc: ["body", "text"], msg: "field required", type: "missing" }] }),
    ]);
    const err = await tts(client(fetch).c).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as Error).message).toMatch(/field required/);
  });

  it("5xx -> ProviderError without retry", async () => {
    const { fetch, calls } = mockFetch([new Response("boom", { status: 500 })]);
    await expect(tts(client(fetch).c)).rejects.toBeInstanceOf(ProviderError);
    expect(calls).toHaveLength(1);
  });

  it("network failure -> ProviderError", async () => {
    const f = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const err = await tts(client(f).c).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).httpStatus).toBe(0);
  });

  it("429 retries with exponential backoff, then succeeds", async () => {
    const rl = () => json(429, { detail: { code: "rate_limit_exceeded", message: "slow down" } });
    const { fetch, calls } = mockFetch([rl, rl, json(200, { tier: "pro", character_count: 1, character_limit: 2 })]);
    const { c, sleep } = client(fetch);
    const out = await c.subscription();
    expect(out.tier).toBe("pro");
    expect(calls).toHaveLength(3);
    expect(sleep.mock.calls.map((a) => a[0])).toEqual([10, 20]);
  });

  it("429 honours Retry-After seconds", async () => {
    const { fetch } = mockFetch([
      () => json(429, { detail: { code: "rate_limit_exceeded" } }, { "retry-after": "2" }),
      json(200, { tier: "pro", character_count: 1, character_limit: 2 }),
    ]);
    const { c, sleep } = client(fetch);
    await c.subscription();
    expect(sleep.mock.calls.map((a) => a[0])).toEqual([2000]);
  });

  it("429 gives up after 3 retries with a ProviderError", async () => {
    const { fetch, calls } = mockFetch([
      () => json(429, { detail: { code: "concurrent_limit_exceeded", message: "busy" } }),
    ]);
    const { c, sleep } = client(fetch);
    const err = await c.subscription().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).httpStatus).toBe(429);
    expect(calls).toHaveLength(4);
    expect(sleep).toHaveBeenCalledTimes(3);
  });
});
