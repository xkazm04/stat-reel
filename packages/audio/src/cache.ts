/**
 * Request-hash cache for every generation (DESIGN §6.4): a rerun with an unchanged script costs
 * nothing. Replay mode reads recorded fixtures only and can never reach the provider.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CharAlignment } from "@statreel/schemas";
import { CacheCorrupt, FixtureMissing } from "./errors";

export type AudioMode = "live" | "replay";
export type AudioKind = "tts" | "music" | "sfx" | "alignment";

const SECRET_KEYS = new Set(["apikey", "api_key", "xi-api-key", "authorization"]);

/** JSON with recursively sorted keys; `undefined` members dropped; secret-looking keys removed. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map((x) => (x === undefined ? null : canonicalize(x)));
  if (v && typeof v === "object") {
    if (Buffer.isBuffer(v)) return { sha256: sha256(v) };
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x === undefined || SECRET_KEYS.has(k.toLowerCase())) continue;
      out[k] = canonicalize(x);
    }
    return out;
  }
  return v;
}

export const sha256 = (data: string | Buffer | Uint8Array) => createHash("sha256").update(data).digest("hex");

/** sha256 of the canonical JSON of the request (endpoint + body, never the API key). */
export const requestKey = (request: unknown) => sha256(canonicalJson(request));

export interface Produced {
  audio: Buffer;
  alignment?: CharAlignment;
  normalizedAlignment?: CharAlignment;
  requestId?: string;
  model?: string;
  /** the account's plan tier when the provider generated this (rights are not retroactive) */
  planTier?: string;
}

export interface CacheMeta {
  key: string;
  kind: AudioKind;
  request: unknown;
  alignment: CharAlignment | null;
  normalized_alignment: CharAlignment | null;
  request_id: string | null;
  model: string | null;
  /** plan tier at generation time; absent on entries written before it was recorded */
  plan_tier?: string | null;
  generated_at: string;
  sha256: string;
  bytes: number;
}

export interface CacheEntry {
  key: string;
  audio: Buffer;
  meta: CacheMeta;
  audioPath: string;
  metaPath: string;
  cached: boolean;
  source: "generated" | "cache" | "fixture";
}

export interface AudioCacheOptions {
  dir: string;
  mode: AudioMode;
  fixturesDir: string;
  /** copy entries into fixturesDir; defaults to env AUDIO_RECORD=1 at call time */
  record?: boolean;
}

export class AudioCache {
  readonly dir: string;
  readonly mode: AudioMode;
  readonly fixturesDir: string;
  private readonly record: boolean | undefined;

  constructor(opts: AudioCacheOptions) {
    if (opts.mode !== "live" && opts.mode !== "replay")
      throw new Error(`AudioCache mode must be live|replay, got ${String(opts.mode)}`);
    this.dir = opts.dir;
    this.mode = opts.mode;
    this.fixturesDir = opts.fixturesDir;
    this.record = opts.record;
  }

  private get recording(): boolean {
    return this.record ?? process.env.AUDIO_RECORD === "1";
  }

  /** Paths for a key in a directory. */
  static paths(dir: string, key: string) {
    return { audioPath: join(dir, `${key}.mp3`), metaPath: join(dir, `${key}.json`) };
  }

  /** Read-only lookup (no produce): cache dir in live mode, fixtures in replay mode. */
  peek(request: unknown): CacheEntry | undefined {
    const key = requestKey(request);
    const dir = this.mode === "replay" ? this.fixturesDir : this.dir;
    return this.read(dir, key, this.mode === "replay" ? "fixture" : "cache");
  }

  async getOrCreate(kind: AudioKind, request: unknown, produce: () => Promise<Produced>): Promise<CacheEntry> {
    const key = requestKey(request);
    if (this.mode === "replay") {
      const hit = this.read(this.fixturesDir, key, "fixture");
      if (!hit) throw new FixtureMissing(kind, key, this.fixturesDir);
      return hit;
    }
    const hit = this.read(this.dir, key, "cache");
    if (hit) {
      if (this.recording) this.copyToFixtures(key);
      return hit;
    }
    const p = await produce();
    if (!Buffer.isBuffer(p.audio) || p.audio.length === 0)
      throw new CacheCorrupt(`produce() for ${kind} ${key} returned no audio`);
    const meta: CacheMeta = {
      key,
      kind,
      request: JSON.parse(canonicalJson(request)),
      alignment: p.alignment ?? null,
      normalized_alignment: p.normalizedAlignment ?? null,
      request_id: p.requestId ?? null,
      model: p.model ?? null,
      plan_tier: p.planTier ?? null,
      generated_at: new Date().toISOString(),
      sha256: sha256(p.audio),
      bytes: p.audio.length,
    };
    mkdirSync(this.dir, { recursive: true });
    const { audioPath, metaPath } = AudioCache.paths(this.dir, key);
    atomicWrite(audioPath, p.audio);
    // metadata last: its presence marks a complete entry
    atomicWrite(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
    if (this.recording) this.copyToFixtures(key);
    return { key, audio: p.audio, meta, audioPath, metaPath, cached: false, source: "generated" };
  }

  private read(dir: string, key: string, source: "cache" | "fixture"): CacheEntry | undefined {
    const { audioPath, metaPath } = AudioCache.paths(dir, key);
    if (!existsSync(metaPath) || !existsSync(audioPath)) return undefined;
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as CacheMeta;
    const audio = readFileSync(audioPath);
    if (sha256(audio) !== meta.sha256)
      throw new CacheCorrupt(`${audioPath}: audio sha256 does not match ${metaPath}; delete both and regenerate`);
    return { key, audio, meta, audioPath, metaPath, cached: true, source };
  }

  private copyToFixtures(key: string) {
    mkdirSync(this.fixturesDir, { recursive: true });
    const src = AudioCache.paths(this.dir, key);
    const dst = AudioCache.paths(this.fixturesDir, key);
    copyFileSync(src.audioPath, dst.audioPath);
    copyFileSync(src.metaPath, dst.metaPath);
  }
}

function atomicWrite(path: string, data: string | Buffer) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}
