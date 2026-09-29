import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Budget } from "./budget";
import { AudioCache } from "./cache";
import { ElevenLabsClient } from "./client";
import { AudioRefused, BudgetExceeded, TakeRejected } from "./errors";
import { generateMusic, generateTts } from "./generate";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "statreel-audio-gen-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const ttsResponse = (endS: number) =>
  new Response(
    JSON.stringify({
      audio_base64: Buffer.from(`mp3-${endS}`).toString("base64"),
      alignment: {
        characters: ["a", "b"],
        character_start_times_seconds: [0, endS / 2],
        character_end_times_seconds: [endS / 2, endS],
      },
    }),
    { status: 200, headers: { "request-id": "rid" } },
  );

function deps(
  responses: Array<() => Response>,
  budget = new Budget({ ttsSeconds: 20, musicSeconds: 20 }),
  probe?: (f: string) => Promise<number>,
) {
  let i = 0;
  const fetch = vi.fn(async () => {
    const r = responses[Math.min(i++, responses.length - 1)];
    if (!r) throw new Error("no response");
    return r();
  }) as unknown as typeof globalThis.fetch;
  const client = new ElevenLabsClient({ apiKey: async () => "k", fetch, sleep: async () => {} });
  const cache = new AudioCache({
    dir: join(root, "cache"),
    mode: "live",
    fixturesDir: join(root, "fx"),
    record: false,
  });
  return { client, cache, budget, fetch, probeDurationS: probe };
}

const text = "x".repeat(60); // estimated 4 s

describe("generateTts", () => {
  it("reserves an estimate, settles to the alignment end time, and cache hits cost nothing", async () => {
    const d = deps([() => ttsResponse(3.5)]);
    const params = { voiceId: "v", text, modelId: "eleven_multilingual_v2", sceneId: "s1" };
    const first = await generateTts(d, params);
    expect(first.source).toBe("generated");
    expect(first.durationS).toBe(3.5);
    expect(d.budget.used("tts")).toBe(3.5);
    const second = await generateTts(d, params);
    expect(second.source).toBe("cache");
    expect(d.budget.used("tts")).toBe(3.5);
    expect(d.fetch).toHaveBeenCalledTimes(1);
    expect(first.asset).toMatchObject({
      kind: "tts",
      provider: "elevenlabs",
      request_id: "rid",
      model_id: "eleven_multilingual_v2",
      voice_id: "v",
      scene_id: "s1",
    });
  });

  it("refuses before calling the provider when the estimate exceeds the budget", async () => {
    const d = deps([() => ttsResponse(1)], new Budget({ ttsSeconds: 3, musicSeconds: 3 }));
    await expect(generateTts(d, { voiceId: "v", text, modelId: "m" })).rejects.toBeInstanceOf(BudgetExceeded);
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it("releases the reservation when the provider refuses", async () => {
    const d = deps([
      () =>
        new Response(JSON.stringify({ detail: { code: "content_policy_violation", message: "no" } }), { status: 400 }),
    ]);
    await expect(generateTts(d, { voiceId: "v", text, modelId: "m" })).rejects.toBeInstanceOf(AudioRefused);
    expect(d.budget.used("tts")).toBe(0);
  });
});

describe("generateMusic", () => {
  const music = () => new Response(Buffer.from(`music-${Math.random()}`), { status: 200 });

  it("charges the requested length, accepts an on-length take and serves reruns from cache", async () => {
    const d = deps([music], undefined, async () => 8.02);
    const params = { prompt: "bed", musicLengthMs: 8000, forceInstrumental: true as const };
    const r = await generateMusic(d, params);
    expect(r.take).toBe(1);
    expect(r.durationMs).toBe(8020);
    expect(d.budget.used("music")).toBe(8);
    const again = await generateMusic(d, params);
    expect(again.source).toBe("cache");
    expect(d.budget.used("music")).toBe(8);
    expect(r.asset).toMatchObject({ kind: "music", model_id: "music_v2" });
    expect(r.asset.prompt_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects off-length takes, tries the next take, and gives up after maxTakes", async () => {
    const lengths = [8.5, 8.01];
    let p = 0;
    const d = deps([music], undefined, async () => lengths[Math.min(p++, lengths.length - 1)] ?? 0);
    const r = await generateMusic(d, { prompt: "bed", musicLengthMs: 8000, forceInstrumental: true, maxTakes: 2 });
    expect(r.take).toBe(2);
    expect(r.rejected).toHaveLength(1);
    expect(d.budget.used("music")).toBe(16);

    const d2 = deps([music], new Budget({ ttsSeconds: 75, musicSeconds: 75 }), async () => 9);
    const err = await generateMusic(d2, {
      prompt: "other",
      musicLengthMs: 8000,
      forceInstrumental: true,
      maxTakes: 2,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TakeRejected);
    expect(d2.budget.used("music")).toBe(16);
  });
});
