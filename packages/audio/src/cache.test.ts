import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioCache, canonicalJson, requestKey } from "./cache";
import { buildTtsRequest } from "./client";
import { CacheCorrupt, FixtureMissing } from "./errors";

const alignment = {
  characters: ["a"],
  character_start_times_seconds: [0],
  character_end_times_seconds: [0.4],
};

let root: string;
let dir: string;
let fixturesDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "statreel-audio-cache-"));
  dir = join(root, "cache");
  fixturesDir = join(root, "fixtures");
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

const req = buildTtsRequest({ voiceId: "v", text: "a", modelId: "eleven_multilingual_v2" });
const produced = () => ({ audio: Buffer.from("mp3-a"), alignment, requestId: "r-1", model: "eleven_multilingual_v2" });

describe("canonical request key", () => {
  it("is independent of key order and ignores undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: undefined } })).toBe(
      '{"a":{"d":[1,{"y":2,"z":1}]},"b":1}',
    );
    expect(requestKey({ endpoint: "/x", body: { a: 1, b: 2 } })).toBe(
      requestKey({ body: { b: 2, a: 1 }, endpoint: "/x" }),
    );
    expect(requestKey({ endpoint: "/x", body: { a: 1 } })).toMatch(/^[0-9a-f]{64}$/);
  });

  it("strips any api key field so the key never changes the hash or lands on disk", () => {
    expect(requestKey({ endpoint: "/x", body: { a: 1 }, apiKey: "sk" })).toBe(
      requestKey({ endpoint: "/x", body: { a: 1 } }),
    );
    expect(requestKey({ endpoint: "/x", headers: { "xi-api-key": "sk" } })).toBe(
      requestKey({ endpoint: "/x", headers: {} }),
    );
  });

  it("changes with the body", () => {
    expect(requestKey({ endpoint: "/x", body: { a: 1 } })).not.toBe(requestKey({ endpoint: "/x", body: { a: 2 } }));
  });
});

describe("AudioCache live", () => {
  it("produces once, writes mp3 + metadata, then serves the cached copy", async () => {
    const cache = new AudioCache({ dir, mode: "live", fixturesDir, record: false });
    const produce = vi.fn(async () => produced());
    const first = await cache.getOrCreate("tts", req, produce);
    expect(first.source).toBe("generated");
    expect(first.cached).toBe(false);
    expect(first.key).toBe(requestKey(req));
    expect(readFileSync(join(dir, `${first.key}.mp3`)).toString()).toBe("mp3-a");
    const meta = JSON.parse(readFileSync(join(dir, `${first.key}.json`), "utf8"));
    expect(meta).toMatchObject({
      kind: "tts",
      key: first.key,
      request: req,
      alignment,
      request_id: "r-1",
      model: "eleven_multilingual_v2",
    });
    expect(meta.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Date.parse(meta.generated_at)).not.toBeNaN();
    expect(existsSync(fixturesDir)).toBe(false);

    const second = await cache.getOrCreate("tts", req, produce);
    expect(second.source).toBe("cache");
    expect(second.cached).toBe(true);
    expect(second.audio.toString()).toBe("mp3-a");
    expect(second.meta.alignment).toEqual(alignment);
    expect(produce).toHaveBeenCalledTimes(1);
  });

  it("AUDIO_RECORD=1 copies both files into fixturesDir", async () => {
    vi.stubEnv("AUDIO_RECORD", "1");
    const cache = new AudioCache({ dir, mode: "live", fixturesDir });
    const r = await cache.getOrCreate("tts", req, async () => produced());
    expect(readFileSync(join(fixturesDir, `${r.key}.mp3`)).toString()).toBe("mp3-a");
    expect(JSON.parse(readFileSync(join(fixturesDir, `${r.key}.json`), "utf8")).key).toBe(r.key);
  });

  it("does not write anything when produce fails", async () => {
    const cache = new AudioCache({ dir, mode: "live", fixturesDir, record: false });
    await expect(
      cache.getOrCreate("tts", req, async () => {
        throw new Error("provider down");
      }),
    ).rejects.toThrow("provider down");
    expect(existsSync(join(dir, `${requestKey(req)}.mp3`))).toBe(false);
  });
});

describe("AudioCache replay", () => {
  it("reads from fixturesDir only and never calls produce", async () => {
    vi.stubEnv("AUDIO_RECORD", "1");
    const live = new AudioCache({ dir, mode: "live", fixturesDir });
    await live.getOrCreate("tts", req, async () => produced());

    const replay = new AudioCache({ dir: join(root, "other"), mode: "replay", fixturesDir });
    const produce = vi.fn(async () => produced());
    const r = await replay.getOrCreate("tts", req, produce);
    expect(r.source).toBe("fixture");
    expect(r.audio.toString()).toBe("mp3-a");
    expect(r.meta.alignment).toEqual(alignment);
    expect(produce).not.toHaveBeenCalled();
  });

  it("throws FixtureMissing with the key and a hint when absent", async () => {
    // a populated live cache must not satisfy replay: replay reads fixtures only
    const live = new AudioCache({ dir, mode: "live", fixturesDir, record: false });
    await live.getOrCreate("tts", req, async () => produced());
    const replay = new AudioCache({ dir, mode: "replay", fixturesDir });
    const produce = vi.fn(async () => produced());
    const err = await replay.getOrCreate("tts", req, produce).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FixtureMissing);
    expect((err as FixtureMissing).key).toBe(requestKey(req));
    expect((err as Error).message).toContain(requestKey(req));
    expect((err as FixtureMissing).hint).toMatch(/AUDIO_RECORD=1/);
    expect(produce).not.toHaveBeenCalled();
  });

  it("a truncated or empty fixture record is CacheCorrupt naming the file, not a bare JSON error", async () => {
    vi.stubEnv("AUDIO_RECORD", "1");
    const live = new AudioCache({ dir, mode: "live", fixturesDir });
    const r = await live.getOrCreate("tts", req, async () => produced());
    const replay = new AudioCache({ dir, mode: "replay", fixturesDir });
    const metaPath = join(fixturesDir, `${r.key}.json`);
    for (const broken of ['{"key":"', "null", ""]) {
      writeFileSync(metaPath, broken);
      const err = await replay.getOrCreate("tts", req, async () => produced()).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(CacheCorrupt);
      expect((err as Error).message).toContain(metaPath);
      expect((err as Error).message).toMatch(/delete both and regenerate/);
    }
  });

  it("rejects a fixture whose audio does not match its recorded sha256", async () => {
    vi.stubEnv("AUDIO_RECORD", "1");
    const live = new AudioCache({ dir, mode: "live", fixturesDir });
    const r = await live.getOrCreate("tts", req, async () => produced());
    writeFileSync(join(fixturesDir, `${r.key}.mp3`), "tampered");
    const replay = new AudioCache({ dir, mode: "replay", fixturesDir });
    await expect(replay.getOrCreate("tts", req, async () => produced())).rejects.toThrow(/sha256/);
  });
});
