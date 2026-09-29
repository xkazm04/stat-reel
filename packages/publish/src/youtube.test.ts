/** YouTube adapter tests. Dry mode must not touch the network; live mode runs against a mocked fetch. */
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { TokenProvider } from "./oauth";
import {
  CHUNK_QUANTUM,
  chunkRanges,
  dryVideoId,
  nextOffset,
  publishModeFromEnv,
  type UploadVideoRequest,
  YouTubeApiError,
  YouTubeClient,
} from "./youtube";

let dir: string;
let video: string;
let srt: string;
const videoBytes = Buffer.alloc(CHUNK_QUANTUM * 2 + 100, 1); // 3 chunks at 256 KiB
const tokens: TokenProvider = { getAccessToken: async () => "tok" };
const noNetwork = vi.fn(async () => {
  throw new Error("network used in dry mode");
}) as unknown as typeof fetch;

const req = (over: Partial<UploadVideoRequest> = {}): UploadVideoRequest => ({
  file: video,
  title: "Most points ≠ most dominant",
  description: "Era-adjusted F1.\n\nData: F1DB (CC BY 4.0)",
  tags: ["F1", "era adjusted"],
  containsSyntheticMedia: true,
  categoryId: "17",
  ...over,
});

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "statreel-yt-"));
  video = join(dir, "video.mp4");
  srt = join(dir, "captions.srt");
  await writeFile(video, videoBytes);
  await writeFile(srt, "1\n00:00:00,000 --> 00:00:01,000\nHello\n");
});

describe("publish mode", () => {
  it("defaults to dry and rejects unknown values", () => {
    expect(publishModeFromEnv({})).toBe("dry");
    expect(publishModeFromEnv({ PUBLISH_MODE: "live" })).toBe("live");
    expect(() => publishModeFromEnv({ PUBLISH_MODE: "yolo" })).toThrow();
  });

  it("live mode requires a token provider", () => {
    expect(() => new YouTubeClient({ mode: "live" })).toThrow(/tokenProvider/);
  });
});

describe("dry mode", () => {
  it("returns a deterministic id and writes the exact request plan without network", async () => {
    const planFile = join(dir, "plan", "youtube.json");
    const yt = new YouTubeClient({ mode: "dry", planFile, fetch: noNetwork, chunkSize: CHUNK_QUANTUM });
    const r = await yt.uploadVideo(req());
    const sha = createHash("sha256").update(videoBytes).digest("hex");
    expect(r).toEqual({ id: dryVideoId(sha, req().title), privacyStatus: "private", mode: "dry" });
    expect(r.id).toMatch(/^dry-[0-9a-f]{8}$/);
    expect((await new YouTubeClient({ mode: "dry" }).uploadVideo(req())).id).toBe(r.id);

    await yt.insertCaptions(r.id, srt, "en", "English");
    await yt.getVideo(r.id);
    await yt.deleteVideo(r.id);
    expect(noNetwork).not.toHaveBeenCalled();

    const plan = JSON.parse(await readFile(planFile, "utf8"));
    expect(plan.mode).toBe("dry");
    const [init, ...rest] = plan.requests;
    expect(init.method).toBe("POST");
    expect(init.url).toBe(
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status&notifySubscribers=false",
    );
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Length": String(videoBytes.length),
      "X-Upload-Content-Type": "video/mp4",
    });
    expect(init.headers.Authorization).toBeUndefined();
    expect(init.body).toEqual({
      snippet: { title: req().title, description: req().description, tags: ["F1", "era adjusted"], categoryId: "17" },
      status: { privacyStatus: "private", selfDeclaredMadeForKids: false, containsSyntheticMedia: true },
    });
    const puts = rest.filter((p: { method: string }) => p.method === "PUT");
    expect(puts.map((p: { headers: Record<string, string> }) => p.headers["Content-Range"])).toEqual([
      `bytes 0-${CHUNK_QUANTUM - 1}/${videoBytes.length}`,
      `bytes ${CHUNK_QUANTUM}-${2 * CHUNK_QUANTUM - 1}/${videoBytes.length}`,
      `bytes ${2 * CHUNK_QUANTUM}-${videoBytes.length - 1}/${videoBytes.length}`,
    ]);
    const cap = plan.requests.find((p: { url: string }) => p.url.includes("/captions"));
    expect(cap.url).toBe("https://www.googleapis.com/upload/youtube/v3/captions?uploadType=multipart&part=snippet");
    expect(cap.headers["Content-Type"]).toMatch(/^multipart\/related; boundary=statreel-[0-9a-f]{8}$/);
    expect(cap.body.multipart[0].json).toEqual({
      snippet: { videoId: r.id, language: "en", name: "English", isDraft: false },
    });
    expect(plan.requests.at(-2)).toMatchObject({
      method: "GET",
      url: `https://www.googleapis.com/youtube/v3/videos?part=status,statistics&id=${r.id}`,
    });
    expect(plan.requests.at(-1)).toMatchObject({
      method: "DELETE",
      url: `https://www.googleapis.com/youtube/v3/videos?id=${r.id}`,
    });
  });

  it("refuses non-private uploads in dry mode", async () => {
    const yt = new YouTubeClient({ mode: "dry", fetch: noNetwork });
    await expect(yt.uploadVideo(req({ privacyStatus: "public" }))).rejects.toThrow(/owner's explicit approval/);
    await expect(yt.uploadVideo(req({ privacyStatus: "unlisted" }))).rejects.toThrow(/private only/);
    expect(yt.plan).toEqual([]);
  });

  it("validates the snippet", async () => {
    const yt = new YouTubeClient({ mode: "dry" });
    await expect(yt.uploadVideo(req({ title: "x".repeat(101) }))).rejects.toThrow(/100/);
    await expect(yt.uploadVideo(req({ description: "a <b>" }))).rejects.toThrow(/'<'/);
  });

  it("dry getVideo reports private", async () => {
    const v = await new YouTubeClient({ mode: "dry" }).getVideo("dry-1");
    expect(v?.status?.privacyStatus).toBe("private");
  });
});

describe("live mode (mocked fetch)", () => {
  it("refuses non-private uploads before any request", async () => {
    const f = vi.fn();
    const yt = new YouTubeClient({ mode: "live", tokenProvider: tokens, fetch: f as unknown as typeof fetch });
    await expect(yt.uploadVideo(req({ privacyStatus: "public" }))).rejects.toThrow(/private only/);
    expect(f).not.toHaveBeenCalled();
  });

  it("runs the resumable protocol, resuming from a 308 Range and a 503", async () => {
    const session = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=xyz";
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const responses: Response[] = [
      new Response(null, { status: 200, headers: { Location: session } }),
      new Response(null, { status: 308, headers: { Range: `bytes=0-${CHUNK_QUANTUM - 1}` } }),
      new Response("oops", { status: 503 }),
      new Response(null, { status: 308, headers: { Range: `bytes=0-${2 * CHUNK_QUANTUM - 1}` } }), // status query
      new Response(JSON.stringify({ id: "vid123", status: { privacyStatus: "private", uploadStatus: "uploaded" } }), {
        status: 200,
      }),
    ];
    const f = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const r = responses.shift();
      if (!r) throw new Error("unexpected request");
      return r;
    });
    const yt = new YouTubeClient({
      mode: "live",
      tokenProvider: tokens,
      fetch: f as unknown as typeof fetch,
      chunkSize: CHUNK_QUANTUM,
      sleep: async () => {},
    });
    const r = await yt.uploadVideo(req());
    expect(r).toMatchObject({ id: "vid123", privacyStatus: "private", mode: "live" });

    const h = (i: number) => calls[i]?.init.headers as Record<string, string>;
    expect(calls[0]?.init.method).toBe("POST");
    expect(h(0).Authorization).toBe("Bearer tok");
    expect(h(0)["Content-Length"]).toBeUndefined();
    expect(JSON.parse(Buffer.from(calls[0]?.init.body as Uint8Array).toString()).status).toEqual({
      privacyStatus: "private",
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: true,
    });
    expect(h(1)["Content-Range"]).toBe(`bytes 0-${CHUNK_QUANTUM - 1}/${videoBytes.length}`);
    expect(h(2)["Content-Range"]).toBe(`bytes ${CHUNK_QUANTUM}-${2 * CHUNK_QUANTUM - 1}/${videoBytes.length}`);
    expect(h(3)["Content-Range"]).toBe(`bytes */${videoBytes.length}`);
    expect(h(4)["Content-Range"]).toBe(`bytes ${2 * CHUNK_QUANTUM}-${videoBytes.length - 1}/${videoBytes.length}`);
    expect(calls.slice(1).every((c) => c.url === session && c.init.method === "PUT")).toBe(true);
  });

  it("throws if YouTube returns a non-private video", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { Location: "https://s" } }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "v", status: { privacyStatus: "public" } }), { status: 201 }),
      );
    const yt = new YouTubeClient({ mode: "live", tokenProvider: tokens, fetch: f as unknown as typeof fetch });
    await expect(yt.uploadVideo(req())).rejects.toThrow(/expected 'private'/);
  });

  it("sends captions as multipart/related", async () => {
    const f = vi.fn(
      async () => new Response(JSON.stringify({ id: "cap1", snippet: { language: "en" } }), { status: 200 }),
    );
    const yt = new YouTubeClient({ mode: "live", tokenProvider: tokens, fetch: f as unknown as typeof fetch });
    const t = await yt.insertCaptions("vid123", srt, "en");
    expect(t.id).toBe("cap1");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://www.googleapis.com/upload/youtube/v3/captions?uploadType=multipart&part=snippet");
    const ct = (init.headers as Record<string, string>)["Content-Type"] ?? "";
    const boundary = ct.split("boundary=")[1];
    const body = Buffer.from(init.body as Uint8Array).toString();
    expect(body.startsWith(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`)).toBe(true);
    expect(body).toContain('"videoId":"vid123"');
    expect(body).toContain("00:00:00,000 --> 00:00:01,000");
    expect(body.endsWith(`\r\n--${boundary}--\r\n`)).toBe(true);
  });

  it("gets, deletes, and batches stats", async () => {
    const f = vi.fn(async (url: string, init: RequestInit) => {
      if (init.method === "DELETE") return new Response(null, { status: 204 });
      const ids = new URL(url).searchParams.get("id")?.split(",") ?? [];
      return new Response(
        JSON.stringify({
          items: ids.map((id) => ({
            id,
            status: { privacyStatus: "private" },
            statistics: { viewCount: "5", likeCount: "1" },
          })),
        }),
        {
          status: 200,
        },
      );
    });
    const yt = new YouTubeClient({ mode: "live", tokenProvider: tokens, fetch: f as unknown as typeof fetch });
    expect((await yt.getVideo("a"))?.status?.privacyStatus).toBe("private");
    await yt.deleteVideo("a");
    const ids = Array.from({ length: 51 }, (_, i) => `v${i}`);
    const stats = await yt.fetchStats(ids);
    expect(stats).toHaveLength(51);
    expect(stats[0]).toEqual({ videoId: "v0", viewCount: 5, likeCount: 1, commentCount: null });
    expect(f).toHaveBeenCalledTimes(4); // get + delete + 2 stats batches
  });

  it("maps API errors to YouTubeApiError with the reason", async () => {
    const f = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: "quota", errors: [{ reason: "quotaExceeded" }] } }), {
          status: 403,
        }),
    );
    const yt = new YouTubeClient({ mode: "live", tokenProvider: tokens, fetch: f as unknown as typeof fetch });
    const err = await yt.getVideo("a").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(YouTubeApiError);
    expect((err as YouTubeApiError).reason).toBe("quotaExceeded");
  });
});

describe("helpers", () => {
  it("chunks and parses Range", () => {
    expect(chunkRanges(10, 4)).toEqual([
      [0, 3],
      [4, 7],
      [8, 9],
    ]);
    expect(nextOffset("bytes=0-999999")).toBe(1_000_000);
    expect(nextOffset(null)).toBe(0);
  });

  it("rejects chunk sizes that are not multiples of 256 KiB", () => {
    expect(() => new YouTubeClient({ mode: "dry", chunkSize: 1000 })).toThrow();
  });
});
