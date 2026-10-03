import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createSourceHasher, findReusableRender, gcBundles } from "./bundle-support";

const tmp = () => mkdtempSync(path.join(tmpdir(), "statreel-bundle-"));

describe("createSourceHasher", () => {
  const fixture = () => {
    const root = tmp();
    const src = path.join(root, "packages", "viz", "src");
    mkdirSync(src, { recursive: true });
    writeFileSync(path.join(src, "a.ts"), "export const a = 1;");
    writeFileSync(path.join(src, "a.test.ts"), "ignored");
    return { root, file: path.join(src, "a.ts") };
  };

  it("reads the sources once; later calls only stat, and an edit re-hashes", async () => {
    const { root, file } = fixture();
    const h = createSourceHasher(root, ["viz"]);
    const first = await h.hash();
    expect(h.reads).toBe(1); // a.test.ts is not part of the bundle
    expect(await h.hash()).toBe(first);
    expect(await h.hash()).toBe(first);
    expect(h.reads).toBe(1);
    writeFileSync(file, "export const a = 22;");
    const later = new Date(Date.now() + 5000);
    utimesSync(file, later, later);
    const second = await h.hash();
    expect(second).not.toBe(first);
    expect(h.reads).toBe(2);
  });
});

describe("gcBundles", () => {
  it("keeps the newest N and the current bundle, removing the rest", async () => {
    const root = tmp();
    const names = ["old1", "old2", "mid", "new1", "new2"];
    names.forEach((n, i) => {
      mkdirSync(path.join(root, n), { recursive: true });
      const t = new Date(Date.now() - (names.length - i) * 60_000);
      utimesSync(path.join(root, n), t, t);
    });
    const removed = await gcBundles(root, 2, "old1");
    expect(removed.map((r) => path.basename(r)).sort()).toEqual(["mid", "old2"]);
    for (const n of ["old1", "new1", "new2"]) expect(existsSync(path.join(root, n))).toBe(true);
    expect(await gcBundles(path.join(root, "missing"), 2, "x")).toEqual([]);
  });
});

describe("findReusableRender", () => {
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  const render = (over: { props?: string; source?: string; video?: string; thumb?: boolean } = {}) => {
    const dir = tmp();
    const video = path.join(dir, "video.mp4");
    writeFileSync(video, "video-bytes");
    for (const f of ["captions.srt", "captions.vtt"]) writeFileSync(path.join(dir, f), "c");
    if (over.thumb !== false) writeFileSync(path.join(dir, "thumb.png"), "t");
    const manifest = {
      build: { props_sha256: over.props ?? "P", source_sha256: over.source ?? "S" },
      subject: { sha256: sha(over.video ?? "video-bytes") }, captions: { sidecar: ["captions.srt", "captions.vtt"] },
    };
    writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest));
    return { format: "vertical", path: video, manifest_path: path.join(dir, "manifest.json") };
  };
  const want = { propsSha: "P", sourceHash: "S", format: "vertical" };

  it("reuses an identical, intact render", async () => {
    expect(await findReusableRender(render(), want)).not.toBeNull();
  });

  it("does not reuse on changed props, source, format, missing files or a video that no longer matches", async () => {
    expect(await findReusableRender(render({ props: "other" }), want)).toBeNull();
    expect(await findReusableRender(render({ source: "other" }), want)).toBeNull();
    expect(await findReusableRender(render(), { ...want, format: "landscape" })).toBeNull();
    expect(await findReusableRender(render({ thumb: false }), want)).toBeNull();
    expect(await findReusableRender(render({ video: "tampered" }), want)).toBeNull();
    expect(await findReusableRender(undefined, want)).toBeNull();
    expect(await findReusableRender({ format: "vertical", path: "/nope.mp4", manifest_path: "/nope.json" }, want)).toBeNull();
  });
});
