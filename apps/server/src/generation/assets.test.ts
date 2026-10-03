import { mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GenerationConfigSchema, type GenerationJob } from "@statreel/schemas";
import { AssetFetcher, type AssetDeps, normaliseLicence, sanitizeSvg, sniffMime } from "./assets";
import { jobPaths } from "./paths";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.from("IHDR"), Buffer.from([0, 0, 0, 4, 0, 0, 0, 4, 8, 6, 0, 0, 0]), Buffer.alloc(20)]);
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>';
const EVIL = '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" onload="alert(1)"><script>alert(2)</script><foreignObject><iframe src="https://evil"/></foreignObject><image xlink:href="https://evil.example/x.png"/><a href="javascript:alert(3)"><rect onclick="x()" width="1" height="1" style="fill:url(https://evil.example/f)"/></a><use href="#ok"/><style>@import url(https://evil.example/s.css); .a{fill:red}</style></svg>';

let dir: string;
let job: GenerationJob;
let calls: { url: string; headers: Record<string, string> }[];
type Handler = (url: string) => Response | Promise<Response>;
let handler: Handler;

const commonsApi = (o: { short?: string; restrictions?: string; missing?: boolean; url?: string } = {}) =>
  Response.json({ query: { pages: [o.missing ? { title: "File:X", missing: true } : { title: "File:X", imageinfo: [{ url: o.url ?? "https://upload.wikimedia.org/wikipedia/commons/2/2f/X.svg", mime: "image/svg+xml", extmetadata: {
    LicenseShortName: { value: o.short ?? "Public domain" }, LicenseUrl: { value: "https://creativecommons.org/publicdomain/zero/1.0/" }, Artist: { value: '<a href="x">Some <b>Artist</b></a>' },
    Credit: { value: "Own work" }, Restrictions: { value: o.restrictions ?? "trademarked" } } }] }] } });
const file = (body: Buffer | string, type: string, status = 200, extra: Record<string, string> = {}) => new Response(typeof body === "string" ? body : new Uint8Array(body), { status, headers: { "content-type": type, ...extra } });

function fetcher(over: Partial<AssetDeps> = {}) {
  return new AssetFetcher({
    config: GenerationConfigSchema.parse({}).web.download, dataRoot: dir, getJob: (id) => (id === job.id ? job : undefined), contact: "owner@example.test",
    sleep: async () => {}, minIntervalMs: 0, now: () => "2026-10-03T00:00:00.000Z",
    fetchFn: (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)) });
      return handler(String(url));
    }) as typeof fetch,
    ...over,
  });
}
const input = (o: object = {}) => ({ job_id: job.id, url: "https://commons.wikimedia.org/wiki/File:X.svg", kind: "logo", entity: "Ferrari", source_page: "https://commons.wikimedia.org/wiki/File:X.svg", ...o });

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "statreel-assets-"));
  job = { id: "gj-0123abcd", status: "running", type: "visual_options" } as GenerationJob;
  const p = jobPaths(job.id, dir);
  mkdirSync(p.out, { recursive: true });
  calls = [];
  handler = (u) => (u.includes("api.php") ? commonsApi() : file(SVG, "image/svg+xml"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const ledger = () => {
  const f = path.join(jobPaths(job.id, dir).out, "assets.json");
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : [];
};

describe("fetch_asset", () => {
  it("downloads a Commons file under work/assets with a server-chosen name and a verified ledger row", async () => {
    const r = await fetcher().fetchAsset(input());
    expect(r).toMatchObject({ ok: true, file: "assets/logos/ferrari.svg", licence: "PD", trademark: true, verified_by: "commons-api" });
    const p = jobPaths(job.id, dir);
    expect(readFileSync(path.join(p.work, "assets", "logos", "ferrari.svg"), "utf8")).toContain("<svg");
    const rows = ledger();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      entity: "Ferrari", kind: "logo", file: "assets/logos/ferrari.svg", licence: "PD", author: "Some Artist", credit: "Own work", trademark: true, verified_by: "commons-api",
      url: "https://upload.wikimedia.org/wikipedia/commons/2/2f/X.svg", source_page: "https://commons.wikimedia.org/wiki/File:X.svg", fetched_at: "2026-10-03T00:00:00.000Z",
    });
    expect(rows[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    // the authoritative copy sits outside work/, beyond the session's reach
    expect(existsSync(path.join(p.dir, "fetched-assets.json"))).toBe(true);
    expect(path.relative(p.work, path.join(p.dir, "fetched-assets.json")).startsWith("..")).toBe(true);
  });

  it("sends a descriptive User-Agent with the owner contact and never fetches in parallel", async () => {
    let active = 0;
    let max = 0;
    handler = async (u) => { active++; max = Math.max(max, active); await new Promise((r) => setTimeout(r, 5)); active--; return u.includes("api.php") ? commonsApi() : file(SVG, "image/svg+xml"); };
    const f = fetcher();
    await Promise.all([f.fetchAsset(input({ entity: "A" })), f.fetchAsset(input({ entity: "B" })), f.fetchAsset(input({ entity: "C" }))]);
    expect(max).toBe(1);
    expect(calls.length).toBe(6);
    for (const c of calls) expect(c.headers["user-agent"]).toMatch(/^StatReel\/\S+ \(\+owner@example\.test\)$/);
  });

  it("pauses between Wikimedia requests", async () => {
    const waits: number[] = [];
    await fetcher({ minIntervalMs: 500, sleep: async (ms) => void waits.push(ms) }).fetchAsset(input());
    expect(waits.some((w) => w > 0 && w <= 500)).toBe(true);
  });

  it("without an owner contact it refuses (no default User-Agent)", async () => {
    const r = await fetcher({ contact: null }).fetchAsset(input());
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toMatch(/contact/);
    expect(calls).toHaveLength(0);
  });

  it("rejects http, foreign hosts, credentials and odd ports", async () => {
    const f = fetcher();
    expect(await f.fetchAsset(input({ url: "http://commons.wikimedia.org/wiki/File:X.svg" }))).toMatchObject({ ok: false, error: expect.stringMatching(/https/) });
    expect(await f.fetchAsset(input({ url: "https://evil.example/logo.svg" }))).toMatchObject({ ok: false, error: expect.stringMatching(/allowlist/) });
    expect(await f.fetchAsset(input({ url: "https://user:pw@commons.wikimedia.org/wiki/File:X.svg" }))).toMatchObject({ ok: false });
    expect(await f.fetchAsset(input({ url: "https://commons.wikimedia.org:8443/wiki/File:X.svg" }))).toMatchObject({ ok: false });
    expect(await f.fetchAsset(input({ url: "https://upload.wikimedia.org.evil.example/x.svg" }))).toMatchObject({ ok: false });
    expect(calls).toHaveLength(0);
  });

  it("rejects a wrong MIME type (content is not PNG/SVG/WEBP) and a served-type mismatch", async () => {
    handler = (u) => (u.includes("api.php") ? commonsApi() : file("GIF89a....", "image/gif"));
    expect(await fetcher().fetchAsset(input())).toMatchObject({ ok: false, error: expect.stringMatching(/not a PNG, SVG or WEBP/) });
    handler = (u) => (u.includes("api.php") ? commonsApi() : file(PNG, "image/svg+xml"));
    expect(await fetcher().fetchAsset(input({ entity: "B" }))).toMatchObject({ ok: false, error: expect.stringMatching(/served as/) });
    expect(ledger()).toEqual([]);
  });

  it("rejects an oversize download (header and streamed)", async () => {
    const small = GenerationConfigSchema.parse({ web: { download: { maxBytes: 50 } } }).web.download;
    handler = (u) => (u.includes("api.php") ? commonsApi() : file(SVG, "image/svg+xml", 200, { "content-length": "999" }));
    expect(await fetcher({ config: small }).fetchAsset(input())).toMatchObject({ ok: false, error: expect.stringMatching(/cap/) });
    handler = (u) => (u.includes("api.php") ? commonsApi() : file(SVG, "image/svg+xml"));
    expect(await fetcher({ config: small }).fetchAsset(input({ entity: "B" }))).toMatchObject({ ok: false, error: expect.stringMatching(/cap/) });
  });

  it("re-checks every redirect hop against the allowlist", async () => {
    handler = (u) => (u.includes("api.php") ? commonsApi() : new Response(null, { status: 302, headers: { location: "https://evil.example/steal.svg" } }));
    const r = await fetcher().fetchAsset(input());
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/redirect rejected/) });
    expect(calls.some((c) => c.url.includes("evil.example"))).toBe(false);
    // an allowed redirect (same allowlist) is followed
    let hops = 0;
    handler = (u) => (u.includes("api.php") ? commonsApi() : hops++ === 0 ? new Response(null, { status: 301, headers: { location: "https://upload.wikimedia.org/final.svg" } }) : file(SVG, "image/svg+xml"));
    expect(await fetcher().fetchAsset(input({ entity: "Ok" }))).toMatchObject({ ok: true });
  });

  it("rejects a licence outside the allowlist, with the reason", async () => {
    handler = (u) => (u.includes("api.php") ? commonsApi({ short: "CC BY-NC 4.0" }) : file(SVG, "image/svg+xml"));
    const r = await fetcher().fetchAsset(input());
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/CC BY-NC 4.0/) });
    expect(ledger()).toEqual([]);
  });

  it("maps Commons licence names and flags non-trademarked files", async () => {
    handler = (u) => (u.includes("api.php") ? commonsApi({ short: "CC BY-SA 4.0", restrictions: "" }) : file(SVG, "image/svg+xml"));
    expect(await fetcher().fetchAsset(input())).toMatchObject({ ok: true, licence: "CC-BY-SA", trademark: false });
    expect(["Public domain", "PD-textlogo", "CC0", "CC BY 4.0", "CC BY-SA 3.0", "GFDL"].map(normaliseLicence)).toEqual(["PD", "PD", "CC0", "CC-BY", "CC-BY-SA", "GFDL"]);
  });

  it("a missing Commons file is an error, an upload thumbnail URL resolves to the original", async () => {
    handler = (u) => (u.includes("api.php") ? commonsApi({ missing: true }) : file(SVG, "image/svg+xml"));
    expect(await fetcher().fetchAsset(input())).toMatchObject({ ok: false, error: expect.stringMatching(/no such file/) });
    handler = (u) => (u.includes("api.php") ? commonsApi() : file(SVG, "image/svg+xml"));
    const r = await fetcher().fetchAsset(input({ url: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/X.svg/200px-X.svg.png" }));
    expect(r).toMatchObject({ ok: true });
    expect(calls.find((c) => c.url.includes("api.php"))?.url).toContain(encodeURIComponent("File:X.svg"));
  });

  it("sanitises a malicious SVG before it is written", async () => {
    handler = (u) => (u.includes("api.php") ? commonsApi() : file(EVIL, "image/svg+xml"));
    const r = await fetcher().fetchAsset(input());
    expect(r).toMatchObject({ ok: true });
    const out = readFileSync(path.join(jobPaths(job.id, dir).work, "assets", "logos", "ferrari.svg"), "utf8");
    for (const bad of [/<script/i, /foreignObject/i, /\sonload/i, /\sonclick/i, /evil\.example/, /javascript:/i, /<!ENTITY/i, /<!DOCTYPE/i, /@import/i, /<iframe/i]) expect(out).not.toMatch(bad);
    expect(out).toContain('<use href="#ok"/>');
    expect(out).toContain("<svg");
  });

  it("a network failure is returned as a tool error, not thrown", async () => {
    handler = () => { throw new TypeError("fetch failed"); };
    expect(await fetcher().fetchAsset(input())).toMatchObject({ ok: false, error: expect.stringMatching(/fetch failed/) });
  });

  it("honours maxPerJob", async () => {
    const f = fetcher({ config: GenerationConfigSchema.parse({ web: { download: { maxPerJob: 2 } } }).web.download });
    expect(await f.fetchAsset(input({ entity: "A" }))).toMatchObject({ ok: true });
    expect(await f.fetchAsset(input({ entity: "B" }))).toMatchObject({ ok: true });
    expect(await f.fetchAsset(input({ entity: "C" }))).toMatchObject({ ok: false, error: expect.stringMatching(/limit of 2/) });
    expect(ledger()).toHaveLength(2);
  });

  it("refuses jobs that are not running, unknown jobs and bad input", async () => {
    job.status = "done";
    expect(await fetcher().fetchAsset(input())).toMatchObject({ ok: false, error: expect.stringMatching(/not running/) });
    job.status = "running";
    expect(await fetcher().fetchAsset(input({ job_id: "gj-ffffffff" }))).toMatchObject({ ok: false, error: expect.stringMatching(/unknown job/) });
    expect(await fetcher().fetchAsset({ job_id: job.id, url: "x" })).toMatchObject({ ok: false });
    expect(await fetcher().fetchAsset(input({ kind: "photo" }))).toMatchObject({ ok: false });
  });

  it("file names are server-chosen: the entity cannot traverse; a different file for the same entity gets a hash suffix", async () => {
    const r = await fetcher().fetchAsset(input({ entity: "../../etc/passwd" }));
    expect(r).toMatchObject({ ok: true, file: "assets/logos/etc-passwd.svg" });
    await fetcher().fetchAsset(input({ entity: "Ferrari" }));
    handler = (u) => (u.includes("api.php") ? commonsApi() : file(SVG.replace("10", "11"), "image/svg+xml"));
    const again = (await fetcher().fetchAsset(input({ entity: "Ferrari" }))) as { file: string };
    expect(again.file).toMatch(/^assets\/logos\/ferrari-[0-9a-f]{8}\.svg$/);
  });

  it("non-Wikimedia hosts are off by default; when allowed the row is model-declared and needs a declared licence", async () => {
    const cfg = GenerationConfigSchema.parse({ web: { download: { hosts: ["upload.wikimedia.org", "commons.wikimedia.org", "cdn.example.org"] } } }).web.download;
    handler = () => file(SVG, "image/svg+xml");
    expect(await fetcher({ config: cfg }).fetchAsset(input({ url: "https://cdn.example.org/a.svg" }))).toMatchObject({ ok: false, error: expect.stringMatching(/licence/) });
    const ok = await fetcher({ config: cfg }).fetchAsset(input({ url: "https://cdn.example.org/a.svg", licence: "CC0", author: "me" }));
    expect(ok).toMatchObject({ ok: true, verified_by: "model-declared" });
    expect(await fetcher().fetchAsset(input({ url: "https://cdn.example.org/a.svg", licence: "CC0" }))).toMatchObject({ ok: false, error: expect.stringMatching(/allowlist/) });
  });
});

describe("helpers", () => {
  it("sniffMime", () => {
    expect(sniffMime(PNG)).toBe("image/png");
    expect(sniffMime(Buffer.from(SVG))).toBe("image/svg+xml");
    expect(sniffMime(Buffer.from('<?xml version="1.0"?>\n<svg xmlns=""></svg>'))).toBe("image/svg+xml");
    expect(sniffMime(Buffer.from("<html><svg></svg></html>"))).toBeNull();
    expect(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBeNull();
  });
  it("sanitizeSvg keeps in-document references", () => {
    expect(sanitizeSvg('<svg><use xlink:href="#a"/><use xlink:href="http://x/y#a"/></svg>')).toBe('<svg><use xlink:href="#a"/><use/></svg>');
  });
});
