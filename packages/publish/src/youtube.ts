/**
 * YouTube adapter (Data API v3 + Analytics API v2). API shapes verified 2026-09-29, see API-NOTES.md.
 *
 * PUBLISH_MODE=dry (default): no network at all. Every call appends the exact HTTP request it
 * would make (auth header stripped) to an in-memory plan, written to `planFile` after each call.
 * PUBLISH_MODE=live: real requests via the injected fetch + TokenProvider.
 *
 * In BOTH modes uploads are private only (CLAUDE.md: private/draft unless the owner approves).
 */
import { createHash } from "node:crypto";
import { mkdir, open, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname } from "node:path";
import type { TokenProvider } from "./oauth";

export type PublishMode = "dry" | "live";

export const YT_API = "https://www.googleapis.com/youtube/v3";
export const YT_UPLOAD = "https://www.googleapis.com/upload/youtube/v3";
export const YT_ANALYTICS = "https://youtubeanalytics.googleapis.com/v2/reports";

/** Chunks must be multiples of 256 KiB (except the last). */
export const CHUNK_QUANTUM = 256 * 1024;
export const DEFAULT_CHUNK_SIZE = 32 * CHUNK_QUANTUM; // 8 MiB

export function publishModeFromEnv(env: NodeJS.ProcessEnv = process.env): PublishMode {
  const mode = env.PUBLISH_MODE ?? "dry";
  if (mode !== "dry" && mode !== "live") throw new Error(`PUBLISH_MODE must be 'dry' or 'live', got '${mode}'`);
  return mode;
}

export interface FileRef {
  file: string;
  bytes: number;
  sha256: string;
  contentType: string;
}

export interface PlannedRequest {
  method: "GET" | "POST" | "PUT" | "DELETE";
  url: string;
  /** request headers without Authorization */
  headers: Record<string, string>;
  /** JSON body, or a description of binary/multipart content */
  body?: unknown;
}

export interface UploadVideoRequest {
  file: string;
  title: string;
  description: string;
  tags?: string[];
  /** only "private" is accepted in v1 */
  privacyStatus?: string;
  /** status.containsSyntheticMedia - realistic altered or synthetic content disclosure */
  containsSyntheticMedia: boolean;
  categoryId: string;
  /** status.selfDeclaredMadeForKids (default false) */
  madeForKids?: boolean;
  defaultLanguage?: string;
}

export interface UploadVideoResult {
  id: string;
  privacyStatus: "private";
  mode: PublishMode;
  resource?: YouTubeVideo;
}

export interface YouTubeVideo {
  id: string;
  snippet?: { title?: string; description?: string; tags?: string[]; categoryId?: string };
  status?: {
    privacyStatus?: string;
    uploadStatus?: string;
    containsSyntheticMedia?: boolean;
    selfDeclaredMadeForKids?: boolean;
  };
  statistics?: {
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
    favoriteCount?: string;
    dislikeCount?: string;
  };
}

export interface CaptionTrack {
  id: string;
  snippet?: {
    videoId?: string;
    language?: string;
    name?: string;
    trackKind?: string;
    status?: string;
    isDraft?: boolean;
  };
}

export interface VideoStats {
  videoId: string;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
}

/** YouTube Analytics reports.query response (subset). */
export interface AnalyticsReport {
  columnHeaders: Array<{ name: string; columnType?: string; dataType?: string }>;
  rows?: Array<Array<string | number>>;
}

export const ANALYTICS_METRICS = [
  "views",
  "estimatedMinutesWatched",
  "averageViewDuration",
  "likes",
  "comments",
  "shares",
  "subscribersGained",
  "subscribersLost",
] as const;

export class YouTubeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason?: string,
  ) {
    super(message);
    this.name = "YouTubeApiError";
  }
}

export interface YouTubeClientOptions {
  mode?: PublishMode;
  /** required in live mode */
  tokenProvider?: TokenProvider;
  /** dry mode: where to write the request plan (JSON). Recommended in e2e. */
  planFile?: string;
  fetch?: typeof fetch;
  chunkSize?: number;
  /** live mode: retries per chunk on 5xx / network errors (default 5) */
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".srt": "application/octet-stream",
  ".vtt": "application/octet-stream",
};

async function fileRef(file: string): Promise<FileRef> {
  const [info, buf] = await Promise.all([stat(file), readFile(file)]);
  return {
    file: basename(file),
    bytes: info.size,
    sha256: createHash("sha256").update(buf).digest("hex"),
    contentType: MIME[extname(file).toLowerCase()] ?? "application/octet-stream",
  };
}

const sha8 = (...parts: string[]) => createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 8);

/** `dry-<sha8(file sha256 + title)>` - stable for the same file content and title. */
export function dryVideoId(fileSha256: string, title: string): string {
  return `dry-${sha8(fileSha256, title)}`;
}

export function assertPrivate(privacyStatus: string | undefined): "private" {
  if (privacyStatus !== undefined && privacyStatus !== "private") {
    throw new Error(
      `privacyStatus '${privacyStatus}' refused: v1 uploads private only; making a video public needs the owner's explicit approval`,
    );
  }
  return "private";
}

export function validateSnippet(req: UploadVideoRequest): void {
  const bad = /[<>]/;
  if (!req.title.trim()) throw new Error("title is empty");
  if ([...req.title].length > 100) throw new Error("title exceeds 100 characters");
  if (bad.test(req.title) || bad.test(req.description)) throw new Error("title/description may not contain '<' or '>'");
  if (Buffer.byteLength(req.description, "utf8") > 5000) throw new Error("description exceeds 5000 bytes");
  const tagChars =
    (req.tags ?? []).reduce((n, t) => n + t.length + (t.includes(" ") ? 2 : 0), 0) +
    Math.max(0, (req.tags?.length ?? 0) - 1);
  if (tagChars > 500) throw new Error("tags exceed 500 characters");
}

export function videoInsertBody(req: UploadVideoRequest) {
  return {
    snippet: {
      title: req.title,
      description: req.description,
      tags: req.tags ?? [],
      categoryId: req.categoryId,
      ...(req.defaultLanguage ? { defaultLanguage: req.defaultLanguage } : {}),
    },
    status: {
      privacyStatus: assertPrivate(req.privacyStatus),
      selfDeclaredMadeForKids: req.madeForKids ?? false,
      containsSyntheticMedia: req.containsSyntheticMedia,
    },
  };
}

export class YouTubeClient {
  readonly mode: PublishMode;
  readonly plan: PlannedRequest[] = [];
  private readonly fetchImpl: typeof fetch;
  private readonly chunkSize: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: YouTubeClientOptions = {}) {
    this.mode = opts.mode ?? publishModeFromEnv();
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.chunkSize = opts.chunkSize ?? DEFAULT_CHUNK_SIZE;
    if (this.chunkSize <= 0 || this.chunkSize % CHUNK_QUANTUM !== 0) {
      throw new Error(`chunkSize must be a positive multiple of ${CHUNK_QUANTUM}`);
    }
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    if (this.mode === "live" && !opts.tokenProvider) throw new Error("live mode needs a tokenProvider");
  }

  // ---------------------------------------------------------------- videos.insert (resumable)

  async uploadVideo(req: UploadVideoRequest): Promise<UploadVideoResult> {
    const body = videoInsertBody(req); // throws on non-private before anything else
    validateSnippet(req);
    const ref = await fileRef(req.file);
    if (ref.bytes === 0) throw new Error(`video file is empty: ${req.file}`);
    const initUrl = `${YT_UPLOAD}/videos?uploadType=resumable&part=snippet,status&notifySubscribers=false`;
    const bodyText = JSON.stringify(body);
    const initHeaders = {
      "Content-Type": "application/json; charset=UTF-8",
      "Content-Length": String(Buffer.byteLength(bodyText)),
      "X-Upload-Content-Length": String(ref.bytes),
      "X-Upload-Content-Type": ref.contentType,
    };
    const chunks = chunkRanges(ref.bytes, this.chunkSize);

    if (this.mode === "dry") {
      this.record({ method: "POST", url: initUrl, headers: initHeaders, body });
      for (const [start, end] of chunks) {
        this.record({
          method: "PUT",
          url: "<session-uri from Location header>",
          headers: {
            "Content-Length": String(end - start + 1),
            "Content-Type": ref.contentType,
            "Content-Range": `bytes ${start}-${end}/${ref.bytes}`,
          },
          body: { media: ref, range: [start, end] },
        });
      }
      await this.flushPlan();
      return { id: dryVideoId(ref.sha256, req.title), privacyStatus: "private", mode: "dry" };
    }

    const init = await this.send("POST", initUrl, initHeaders, bodyText);
    await this.ensureOk(init, "videos.insert (init)");
    const session = init.headers.get("location");
    if (!session) throw new YouTubeApiError("resumable session URI missing (no Location header)", init.status);
    const video = (await this.uploadChunks(session, req.file, ref)) as YouTubeVideo;
    const privacy = video.status?.privacyStatus;
    if (privacy !== "private") {
      throw new YouTubeApiError(
        `uploaded video ${video.id} came back with privacyStatus '${privacy}', expected 'private'`,
        200,
      );
    }
    return { id: video.id, privacyStatus: "private", mode: "live", resource: video };
  }

  private async uploadChunks(session: string, path: string, ref: FileRef): Promise<unknown> {
    const fh = await open(path, "r");
    try {
      let offset = 0;
      let attempt = 0;
      while (offset < ref.bytes) {
        const end = Math.min(offset + this.chunkSize, ref.bytes) - 1;
        const len = end - offset + 1;
        const buf = Buffer.alloc(len);
        await fh.read(buf, 0, len, offset);
        let res: Response;
        try {
          res = await this.send(
            "PUT",
            session,
            {
              "Content-Length": String(len),
              "Content-Type": ref.contentType,
              "Content-Range": `bytes ${offset}-${end}/${ref.bytes}`,
            },
            buf,
          );
        } catch (err) {
          const r = await this.retryOrResume(session, ref, ++attempt, err);
          if ("resource" in r) return r.resource;
          offset = r.offset;
          continue;
        }
        if (res.status === 200 || res.status === 201) return res.json();
        if (res.status === 308) {
          offset = nextOffset(res.headers.get("range"));
          attempt = 0;
          continue;
        }
        if (res.status >= 500) {
          const r = await this.retryOrResume(
            session,
            ref,
            ++attempt,
            new YouTubeApiError(`chunk upload ${res.status}`, res.status),
          );
          if ("resource" in r) return r.resource;
          offset = r.offset;
          continue;
        }
        await this.ensureOk(res, "videos.insert (upload)");
      }
      throw new YouTubeApiError("upload finished without a video resource", 0);
    } finally {
      await fh.close();
    }
  }

  /** Backoff, then ask the session how much it has (`Content-Range: bytes * /total`). */
  private async retryOrResume(
    session: string,
    ref: FileRef,
    attempt: number,
    err: unknown,
  ): Promise<{ offset: number } | { resource: unknown }> {
    if (attempt > (this.opts.maxRetries ?? 5)) throw err;
    await this.sleep(Math.min(2 ** attempt * 1000, 64_000));
    let res: Response;
    try {
      res = await this.send("PUT", session, { "Content-Length": "0", "Content-Range": `bytes */${ref.bytes}` });
    } catch (statusErr) {
      return this.retryOrResume(session, ref, attempt + 1, statusErr);
    }
    if (res.status === 308) return { offset: nextOffset(res.headers.get("range")) };
    if (res.status === 200 || res.status === 201) return { resource: await res.json() };
    if (res.status >= 500) return this.retryOrResume(session, ref, attempt + 1, err);
    await this.ensureOk(res, "videos.insert (resume status)");
    return { offset: 0 };
  }

  // ---------------------------------------------------------------- captions.insert (multipart)

  async insertCaptions(videoId: string, file: string, language: string, name = ""): Promise<CaptionTrack> {
    const ref = await fileRef(file);
    const metadata = { snippet: { videoId, language, name, isDraft: false } };
    const boundary = `statreel-${sha8(videoId, ref.sha256)}`;
    const url = `${YT_UPLOAD}/captions?uploadType=multipart&part=snippet`;
    const headers = { "Content-Type": `multipart/related; boundary=${boundary}` };
    if (this.mode === "dry") {
      this.record({
        method: "POST",
        url,
        headers,
        body: {
          multipart: [
            { contentType: "application/json; charset=UTF-8", json: metadata },
            { contentType: ref.contentType, media: ref },
          ],
        },
      });
      await this.flushPlan();
      return { id: `dry-caption-${sha8(videoId, ref.sha256, language)}`, snippet: { videoId, language, name } };
    }
    const media = await readFile(file);
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
      ),
      Buffer.from(`--${boundary}\r\nContent-Type: ${ref.contentType}\r\n\r\n`),
      media,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await this.send("POST", url, headers, payload);
    await this.ensureOk(res, "captions.insert");
    return (await res.json()) as CaptionTrack;
  }

  async listCaptions(videoId: string): Promise<CaptionTrack[]> {
    const url = `${YT_API}/captions?part=snippet&videoId=${encodeURIComponent(videoId)}`;
    if (this.mode === "dry") {
      this.record({ method: "GET", url, headers: {} });
      await this.flushPlan();
      return [];
    }
    const res = await this.send("GET", url, {});
    await this.ensureOk(res, "captions.list");
    return ((await res.json()) as { items?: CaptionTrack[] }).items ?? [];
  }

  // ---------------------------------------------------------------- videos.list / delete

  async getVideo(videoId: string): Promise<YouTubeVideo | null> {
    const url = `${YT_API}/videos?part=status,statistics&id=${encodeURIComponent(videoId)}`;
    if (this.mode === "dry") {
      this.record({ method: "GET", url, headers: {} });
      await this.flushPlan();
      return {
        id: videoId,
        status: { privacyStatus: "private", uploadStatus: "uploaded" },
        statistics: { viewCount: "0", likeCount: "0", commentCount: "0", favoriteCount: "0" },
      };
    }
    const res = await this.send("GET", url, {});
    await this.ensureOk(res, "videos.list");
    return ((await res.json()) as { items?: YouTubeVideo[] }).items?.[0] ?? null;
  }

  async deleteVideo(videoId: string): Promise<void> {
    const url = `${YT_API}/videos?id=${encodeURIComponent(videoId)}`;
    if (this.mode === "dry") {
      this.record({ method: "DELETE", url, headers: {} });
      await this.flushPlan();
      return;
    }
    const res = await this.send("DELETE", url, {});
    if (res.status !== 204) await this.ensureOk(res, "videos.delete");
  }

  /** Lifetime statistics via videos.list (1 unit per call, ids batched by 50). */
  async fetchStats(videoIds: string[]): Promise<VideoStats[]> {
    const out: VideoStats[] = [];
    for (let i = 0; i < videoIds.length; i += 50) {
      const batch = videoIds.slice(i, i + 50);
      const url = `${YT_API}/videos?part=statistics&id=${batch.map(encodeURIComponent).join(",")}`;
      let items: YouTubeVideo[];
      if (this.mode === "dry") {
        this.record({ method: "GET", url, headers: {} });
        items = batch.map((id) => ({ id, statistics: { viewCount: "0", likeCount: "0", commentCount: "0" } }));
      } else {
        const res = await this.send("GET", url, {});
        await this.ensureOk(res, "videos.list (statistics)");
        items = ((await res.json()) as { items?: YouTubeVideo[] }).items ?? [];
      }
      const byId = new Map(items.map((v) => [v.id, v]));
      for (const id of batch) {
        const s = byId.get(id)?.statistics;
        out.push({
          videoId: id,
          viewCount: num(s?.viewCount),
          likeCount: num(s?.likeCount),
          commentCount: num(s?.commentCount),
        });
      }
    }
    if (this.mode === "dry") await this.flushPlan();
    return out;
  }

  /** Daily per-video metrics via YouTube Analytics reports.query (one query per video). */
  async fetchDailyAnalytics(videoId: string, startDate: string, endDate: string): Promise<AnalyticsReport> {
    const q = new URLSearchParams({
      ids: "channel==MINE",
      startDate,
      endDate,
      metrics: ANALYTICS_METRICS.join(","),
      dimensions: "day",
      filters: `video==${videoId}`,
      sort: "day",
    });
    const url = `${YT_ANALYTICS}?${q.toString()}`;
    if (this.mode === "dry") {
      this.record({ method: "GET", url, headers: {} });
      await this.flushPlan();
      return { columnHeaders: [{ name: "day" }, ...ANALYTICS_METRICS.map((name) => ({ name }))], rows: [] };
    }
    const res = await this.send("GET", url, {});
    await this.ensureOk(res, "reports.query");
    return (await res.json()) as AnalyticsReport;
  }

  // ---------------------------------------------------------------- plumbing

  private record(req: PlannedRequest) {
    const headers = Object.fromEntries(
      Object.entries(req.headers).filter(([k]) => k.toLowerCase() !== "authorization"),
    );
    this.plan.push({ ...req, headers });
  }

  private async flushPlan() {
    if (!this.opts.planFile) return;
    await mkdir(dirname(this.opts.planFile), { recursive: true });
    await writeFile(this.opts.planFile, `${JSON.stringify({ mode: "dry", requests: this.plan }, null, 2)}\n`, "utf8");
  }

  private async send(
    method: string,
    url: string,
    headers: Record<string, string>,
    body?: string | Buffer,
  ): Promise<Response> {
    if (this.mode !== "live") throw new Error("network call attempted outside live mode");
    const provider = this.opts.tokenProvider;
    if (!provider) throw new Error("live mode needs a tokenProvider");
    const token = await provider.getAccessToken();
    const h: Record<string, string> = { ...headers, Authorization: `Bearer ${token}` };
    // fetch computes Content-Length itself and forbids setting it.
    delete h["Content-Length"];
    return this.fetchImpl(url, {
      method,
      headers: h,
      body: body === undefined ? undefined : new Uint8Array(typeof body === "string" ? Buffer.from(body) : body),
    });
  }

  private async ensureOk(res: Response, what: string): Promise<void> {
    if (res.ok) return;
    let reason: string | undefined;
    let message = res.statusText;
    try {
      const json = (await res.json()) as { error?: { message?: string; errors?: Array<{ reason?: string }> } };
      reason = json.error?.errors?.[0]?.reason;
      message = json.error?.message ?? message;
    } catch {
      /* non-JSON error body */
    }
    throw new YouTubeApiError(`${what} failed: ${res.status} ${reason ?? ""} ${message}`.trim(), res.status, reason);
  }
}

export function chunkRanges(total: number, size: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let s = 0; s < total; s += size) out.push([s, Math.min(s + size, total) - 1]);
  return out;
}

/** `Range: bytes=0-999999` -> 1000000; no header -> 0 (nothing persisted yet). */
export function nextOffset(range: string | null): number {
  const m = range ? /bytes=\d+-(\d+)/.exec(range) : null;
  return m?.[1] ? Number(m[1]) + 1 : 0;
}

function num(v: string | undefined): number | null {
  if (v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
