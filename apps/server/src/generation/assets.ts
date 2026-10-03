/**
 * `fetch_asset` (SPEC D.5, owner decision Q5): the ONLY way a generation session saves a file from the
 * web. The server downloads on the session's behalf under fixed rules: https only, exact host allowlist
 * (redirects re-checked hop by hop), byte cap, MIME sniffing against an allowlist, SVG sanitising, a
 * server-chosen file name inside the job folder, and a per-job call cap. For Wikimedia the licence,
 * author and trademark flag come from the Commons API, never from the model.
 *
 * This is for assets, not data: it is deliberately NOT a data source in data/registry/sources.yaml.
 * Etiquette: one request at a time, a pause between Wikimedia requests, a descriptive User-Agent with
 * the owner's contact (same format as pipeline/statreel_ingest), one polite retry on 429/503.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { GenerationConfig, GenerationJob } from "@statreel/schemas";
import { insideWork, jobPaths } from "./paths";

export const ASSET_KINDS = ["logo", "flag", "emblem", "icon"] as const;
export const FetchAssetInput = z.object({
  job_id: z.string(),
  url: z.string().min(1).max(2000),
  kind: z.enum(ASSET_KINDS),
  entity: z.string().min(1).max(80),
  source_page: z.string().max(2000).optional(),
  /** only meaningful for non-Wikimedia hosts (then recorded as model-declared) */
  licence: z.string().max(80).optional(),
  author: z.string().max(200).optional(),
});
export type FetchAssetInput = z.infer<typeof FetchAssetInput>;

export type LedgerRow = {
  entity: string; kind: string; file: string; sha256: string; bytes: number; url: string; source_page: string | null;
  licence: string; licence_url: string | null; author: string | null; credit: string | null; trademark: boolean; fetched_at: string;
  verified_by: "commons-api" | "model-declared";
};
export type FetchAssetResult = ({ ok: true } & Pick<LedgerRow, "file" | "licence" | "trademark" | "sha256" | "bytes" | "verified_by">) | { ok: false; error: string };

export type AssetDeps = {
  config: GenerationConfig["web"]["download"];
  dataRoot: string;
  getJob: (id: string) => GenerationJob | undefined;
  /** the owner's contact for the User-Agent; null refuses every call (there is deliberately no default) */
  contact: string | null;
  fetchFn?: typeof fetch;
  now?: () => string;
  sleep?: (ms: number) => Promise<void>;
  /** pause between consecutive requests to Wikimedia hosts */
  minIntervalMs?: number;
  version?: string;
};

const MAX_REDIRECTS = 3;
const isWikimedia = (host: string) => host === "wikimedia.org" || host.endsWith(".wikimedia.org");
const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const textOf = (html: unknown) => String(html ?? "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

/** Commons short names ("Public domain", "CC BY-SA 4.0", "PD-textlogo", "CC0") onto the config vocabulary. */
export function normaliseLicence(short: string): string {
  const s = short.trim();
  if (/^(public domain|pd\b|pd-|no restrictions)/i.test(s)) return "PD";
  if (/^cc0|cc zero/i.test(s)) return "CC0";
  if (/(^|[\s-])(nc|nd)([\s-]|$)/i.test(s)) return s; // NonCommercial / NoDerivs are never mapped onto the allowed set
  if (/^cc[- ]by[- ]sa/i.test(s)) return "CC-BY-SA";
  if (/^cc[- ]by/i.test(s)) return "CC-BY";
  return s;
}

export const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "asset";

export type Sniffed = "image/png" | "image/svg+xml" | "image/webp" | null;
export function sniffMime(b: Buffer): Sniffed {
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length > 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  const head = b.subarray(0, 4096).toString("utf8").replace(/^﻿/, "");
  const at = head.search(/<svg[\s>]/i);
  if (at < 0) return null;
  // only an XML declaration, comments and a DOCTYPE may precede the root element
  const prefix = head.slice(0, at).replace(/<\?xml[\s\S]*?\?>/g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<!DOCTYPE[^[>]*(\[[\s\S]*?\])?\s*>/gi, "");
  return prefix.trim() === "" ? "image/svg+xml" : null;
}

/** Cheap decode checks (no image library is a dependency): signatures, header sizes, sane dimensions. */
export function decodeCheck(b: Buffer, mime: Sniffed): string | null {
  if (mime === "image/png") {
    if (b.subarray(12, 16).toString("latin1") !== "IHDR") return "PNG without IHDR";
    const w = b.readUInt32BE(16);
    const h = b.readUInt32BE(20);
    return w > 0 && h > 0 && w <= 16384 && h <= 16384 ? null : `PNG dimensions out of range (${w}x${h})`;
  }
  if (mime === "image/webp") return b.readUInt32LE(4) + 8 <= b.length + 8 && b.readUInt32LE(4) > 4 ? null : "WEBP with a bad RIFF size";
  if (mime === "image/svg+xml") return /<\/svg>\s*$/i.test(b.toString("utf8").trimEnd()) ? null : "SVG is not closed";
  return "unknown image type";
}

/** Strips everything that can execute or phone home. Text-level, so it errs on the side of removing. */
export function sanitizeSvg(svg: string): string {
  let s = svg.replace(/^﻿/, "");
  s = s.replace(/<!DOCTYPE[^[>]*(\[[\s\S]*?\])?\s*>/gi, "").replace(/<!ENTITY[\s\S]*?>/gi, "");
  s = s.replace(/<script\b[\s\S]*?<\/script\s*>/gi, "").replace(/<script\b[^>]*\/>/gi, "");
  s = s.replace(/<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi, "").replace(/<foreignObject\b[^>]*\/>/gi, "");
  s = s.replace(/<(iframe|embed|object|audio|video|animate|set|handler|listener)\b[\s\S]*?(<\/\1\s*>|\/>)/gi, "");
  s = s.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  // external references: keep only in-document fragments (#id)
  s = s.replace(/\s(?:xlink:)?href\s*=\s*("([^"]*)"|'([^']*)'|[^\s>]+)/gi, (m, _all, a, b2) => {
    const v = String(a ?? b2 ?? "").trim();
    return v.startsWith("#") ? m : "";
  });
  s = s.replace(/javascript:[^"'\s>)]*/gi, "");
  s = s.replace(/@import[^;>]*;?/gi, "").replace(/url\(\s*(?!['"]?#)[^)]*\)/gi, "none");
  return s;
}

export class AssetFetcher {
  private chain: Promise<unknown> = Promise.resolve();
  private calls = new Map<string, number>();
  private lastWikimedia = 0;
  constructor(private readonly d: AssetDeps) {}

  /** Serial: calls are queued behind each other so the Wikimedia API never sees parallel requests. */
  fetchAsset(raw: unknown): Promise<FetchAssetResult> {
    const safe = async (): Promise<FetchAssetResult> => {
      try {
        return await this.doFetch(raw);
      } catch (e) {
        // network failures are a tool error the session can read, never an exception through MCP
        return { ok: false, error: `fetch failed: ${e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e)}` };
      }
    };
    const run = this.chain.then(safe, safe);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private get ua() {
    return `StatReel/${this.d.version ?? "0.1.0"} (+${this.d.contact})`;
  }

  private async http(url: string, accept: string): Promise<Response> {
    const f = this.d.fetchFn ?? fetch;
    const sleep = this.d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const host = new URL(url).hostname;
    for (let attempt = 0; ; attempt++) {
      if (isWikimedia(host)) {
        const wait = this.lastWikimedia + (this.d.minIntervalMs ?? 1000) - Date.now();
        if (wait > 0) await sleep(wait);
        this.lastWikimedia = Date.now();
      }
      const res = await f(url, { redirect: "manual", headers: { "user-agent": this.ua, accept } });
      if ((res.status === 429 || res.status === 503) && attempt === 0) {
        const ra = Number(res.headers.get("retry-after"));
        if (Number.isFinite(ra) && ra > 0 && ra <= 10) {
          await sleep(ra * 1000);
          continue;
        }
      }
      return res;
    }
  }

  private hostOk(u: URL): string | null {
    if (u.protocol !== "https:") return "only https URLs are allowed";
    if (u.username || u.password) return "URLs with credentials are not allowed";
    if (u.port && u.port !== "443") return "only the default https port is allowed";
    if (!this.d.config.hosts.map((h) => h.toLowerCase()).includes(u.hostname.toLowerCase())) return `host ${u.hostname} is not in the download allowlist (${this.d.config.hosts.join(", ")})`;
    return null;
  }

  /** GET with manual redirects, every hop re-validated against the allowlist, and a byte cap. */
  private async download(url: string): Promise<{ ok: true; bytes: Buffer; contentType: string } | { ok: false; error: string }> {
    let cur = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const u = new URL(cur);
      const bad = this.hostOk(u);
      if (bad) return { ok: false, error: hop ? `redirect rejected: ${bad}` : bad };
      const res = await this.http(cur, "image/*");
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return { ok: false, error: `redirect without a location (${res.status})` };
        cur = new URL(loc, cur).toString();
        continue;
      }
      if (!res.ok) return { ok: false, error: `download failed: HTTP ${res.status}` };
      const declared = Number(res.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > this.d.config.maxBytes) return { ok: false, error: `file is ${declared} bytes; the cap is ${this.d.config.maxBytes}` };
      const chunks: Buffer[] = [];
      let total = 0;
      const reader = res.body?.getReader();
      if (!reader) return { ok: false, error: "empty response body" };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > this.d.config.maxBytes) {
          await reader.cancel().catch(() => undefined);
          return { ok: false, error: `file exceeds the ${this.d.config.maxBytes} byte cap` };
        }
        chunks.push(Buffer.from(value));
      }
      return { ok: true, bytes: Buffer.concat(chunks), contentType: (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase() };
    }
    return { ok: false, error: "too many redirects" };
  }

  /** File name on Commons from a file page or an upload URL (thumbnails resolve to the original). */
  static commonsTitle(u: URL): string | null {
    const dec = (s: string) => decodeURIComponent(s).replace(/_/g, " ");
    if (u.hostname === "commons.wikimedia.org") {
      const m = /^\/wiki\/(?:File|Image):(.+)$/i.exec(u.pathname);
      if (m) return dec(m[1]!);
      const t = u.searchParams.get("title");
      const m2 = t && /^(?:File|Image):(.+)$/i.exec(t);
      return m2 ? dec(m2[1]!) : null;
    }
    if (u.hostname === "upload.wikimedia.org") {
      const parts = u.pathname.split("/").filter(Boolean);
      const i = parts.indexOf("thumb");
      const name = i >= 0 ? parts[i + 3] : parts.at(-1);
      return name ? dec(name) : null;
    }
    return null;
  }

  private async commonsInfo(title: string): Promise<{ ok: true; info: Record<string, any> } | { ok: false; error: string }> {
    const api = `https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2&prop=imageinfo&iiprop=${encodeURIComponent("url|mime|size|extmetadata")}&titles=${encodeURIComponent(`File:${title}`)}`;
    if (!this.d.config.hosts.includes("commons.wikimedia.org")) return { ok: false, error: "commons.wikimedia.org is not in the download allowlist, so licences cannot be verified" };
    const res = await this.http(api, "application/json");
    if (!res.ok) return { ok: false, error: `Commons API HTTP ${res.status}` };
    const j = (await res.json()) as { query?: { pages?: { missing?: boolean; imageinfo?: Record<string, any>[] }[] } };
    const page = j.query?.pages?.[0];
    const info = page?.imageinfo?.[0];
    if (!page || page.missing || !info) return { ok: false, error: `no such file on Commons: File:${title}` };
    return { ok: true, info };
  }

  private async doFetch(raw: unknown): Promise<FetchAssetResult> {
    const parsed = FetchAssetInput.safeParse(raw);
    if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
    const input = parsed.data;
    if (!this.d.contact?.trim()) return { ok: false, error: "no owner contact configured (STATREEL_CONTACT or .statreel/config.json); downloads are disabled without a User-Agent contact" };
    const job = this.d.getJob(input.job_id);
    if (!job) return { ok: false, error: `unknown job ${input.job_id}` };
    if (job.status !== "running") return { ok: false, error: `job ${job.id} is ${job.status}, not running` };
    const p = jobPaths(job.id, this.d.dataRoot);
    const ledgerFile = path.join(p.out, "assets.json");
    const n = (this.calls.get(job.id) ?? 0) + 1;
    this.calls.set(job.id, n);
    if (n > this.d.config.maxPerJob) return { ok: false, error: `per-job limit of ${this.d.config.maxPerJob} fetch_asset calls reached` };

    let url: URL;
    try { url = new URL(input.url); } catch { return { ok: false, error: "url is not a valid URL" }; }
    const bad = this.hostOk(url);
    if (bad) return { ok: false, error: bad };

    let downloadUrl = url.toString();
    let meta: Pick<LedgerRow, "licence" | "licence_url" | "author" | "credit" | "trademark" | "verified_by">;
    if (isWikimedia(url.hostname)) {
      const title = AssetFetcher.commonsTitle(url);
      if (!title) return { ok: false, error: "give a Commons file page (commons.wikimedia.org/wiki/File:...) or an upload.wikimedia.org file URL" };
      const c = await this.commonsInfo(title);
      if (!c.ok) return c;
      const em = c.info.extmetadata ?? {};
      const short = textOf(em.LicenseShortName?.value);
      if (!short) return { ok: false, error: `Commons has no licence for File:${title}` };
      const licence = normaliseLicence(short);
      if (!this.d.config.licences.includes(licence)) return { ok: false, error: `licence "${short}" (${licence}) is not allowed; allowed: ${this.d.config.licences.join(", ")}` };
      downloadUrl = String(c.info.url);
      meta = {
        licence, licence_url: textOf(em.LicenseUrl?.value) || null, author: textOf(em.Artist?.value) || null, credit: textOf(em.Credit?.value) || null,
        trademark: /trademark/i.test(String(em.Restrictions?.value ?? "")), verified_by: "commons-api",
      };
    } else {
      const lic = normaliseLicence(input.licence ?? "");
      if (!input.licence || !this.d.config.licences.includes(lic)) return { ok: false, error: `a licence in (${this.d.config.licences.join(", ")}) must be declared for non-Wikimedia hosts` };
      meta = { licence: lic, licence_url: null, author: input.author ?? null, credit: null, trademark: false, verified_by: "model-declared" };
    }

    const dl = await this.download(downloadUrl);
    if (!dl.ok) return dl;
    const mime = sniffMime(dl.bytes);
    if (!mime) return { ok: false, error: "the file is not a PNG, SVG or WEBP image" };
    if (!this.d.config.mime.includes(mime)) return { ok: false, error: `type ${mime} is not allowed (${this.d.config.mime.join(", ")})` };
    if (dl.contentType && dl.contentType !== mime && !(mime === "image/svg+xml" && dl.contentType === "text/xml")) return { ok: false, error: `served as ${dl.contentType} but the content is ${mime}` };
    let bytes = dl.bytes;
    if (mime === "image/svg+xml") {
      bytes = Buffer.from(sanitizeSvg(bytes.toString("utf8")), "utf8");
      if (sniffMime(bytes) !== "image/svg+xml") return { ok: false, error: "nothing is left of the SVG after sanitising" };
    }
    const dec = decodeCheck(bytes, mime);
    if (dec) return { ok: false, error: `image check failed: ${dec}` };

    const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "svg";
    const dir = path.join(p.assets, `${input.kind}s`);
    mkdirSync(dir, { recursive: true });
    const digest = sha256(bytes);
    let name = `${slug(input.entity)}.${ext}`;
    if (existsSync(path.join(dir, name)) && sha256(readFileSync(path.join(dir, name))) !== digest) name = `${slug(input.entity)}-${digest.slice(0, 8)}.${ext}`;
    const abs = insideWork(p, path.join("assets", `${input.kind}s`, name));
    writeFileSync(abs, bytes);
    const rel = `assets/${input.kind}s/${name}`;
    const row: LedgerRow = {
      entity: input.entity, kind: input.kind, file: rel, sha256: digest, bytes: bytes.length, url: downloadUrl, source_page: input.source_page ?? null, ...meta,
      fetched_at: (this.d.now ?? (() => new Date().toISOString()))(),
    };
    this.appendLedger(ledgerFile, row);
    // the authoritative copy lives outside work/, where the session cannot write
    this.appendLedger(path.join(p.dir, "fetched-assets.json"), row);
    return { ok: true, file: rel, licence: meta.licence, trademark: meta.trademark, sha256: digest, bytes: bytes.length, verified_by: meta.verified_by };
  }

  private appendLedger(file: string, row: LedgerRow): void {
    let rows: LedgerRow[] = [];
    try {
      const j = JSON.parse(readFileSync(file, "utf8")) as unknown;
      if (Array.isArray(j)) rows = j as LedgerRow[];
    } catch { /* missing or damaged: start over */ }
    rows = rows.filter((r) => r.file !== row.file);
    rows.push(row);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(rows, null, 2)}\n`);
  }
}

/** Owner contact for the User-Agent: STATREEL_CONTACT, else `.statreel/config.json` {"contact"} (as in statreel_ingest). */
export function ownerContact(statreelLocal: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.STATREEL_CONTACT?.trim()) return env.STATREEL_CONTACT.trim();
  try {
    const c = (JSON.parse(readFileSync(path.join(statreelLocal, "config.json"), "utf8")) as { contact?: string }).contact;
    return c?.trim() || null;
  } catch {
    return null;
  }
}
