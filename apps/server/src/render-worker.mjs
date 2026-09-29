/**
 * Render worker - runs as a child process under the render Node (x64 on Windows-on-ARM, ADR 004).
 * Plain ESM (no TS loader) so it runs on any Node. Input: one JSON argument. Output: JSON lines on
 * stdout ({type:"progress"|"done"|"error", ...}). The parent kills the process to cancel.
 *
 *   { mode: "video", compositionId, props, output, bundleDir, entry }
 *   { mode: "stills", compositionId, props, frames: [sec...], outDir, bundleDir, entry }
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const req = createRequire(import.meta.url);
const { bundle } = req("@remotion/bundler");
const { renderMedia, renderStill, selectComposition, ensureBrowser } = req("@remotion/renderer");

const send = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const arg = process.argv[2];
const job = JSON.parse(arg.endsWith(".json") ? readFileSync(arg, "utf8") : arg);

async function serveUrl() {
  // One bundle per code version: bundleDir is keyed by git sha by the parent.
  if (existsSync(path.join(job.bundleDir, "index.html"))) return job.bundleDir;
  mkdirSync(path.dirname(job.bundleDir), { recursive: true });
  send({ type: "progress", stage: "bundle", progress: 0 });
  return bundle({ entryPoint: job.entry, outDir: job.bundleDir, onProgress: (p) => send({ type: "progress", stage: "bundle", progress: p / 100 }) });
}

try {
  await ensureBrowser();
  const url = await serveUrl();
  const composition = await selectComposition({ serveUrl: url, id: job.compositionId, inputProps: job.props, logLevel: "warn" });
  if (job.mode === "video") {
    await renderMedia({
      composition, serveUrl: url, inputProps: job.props, outputLocation: job.output,
      codec: "h264", crf: 18, pixelFormat: "yuv420p", audioCodec: "aac", logLevel: "warn",
      onProgress: ({ progress }) => send({ type: "progress", stage: "render", progress }),
    });
    send({ type: "done", output: job.output, durationInFrames: composition.durationInFrames, fps: composition.fps, width: composition.width, height: composition.height });
  } else {
    mkdirSync(job.outDir, { recursive: true });
    const stills = [];
    for (const s of job.frames) {
      const frame = Math.min(composition.durationInFrames - 1, Math.max(0, Math.round(s * composition.fps)));
      const output = path.join(job.outDir, `still-${String(frame).padStart(5, "0")}.png`);
      await renderStill({ composition, serveUrl: url, inputProps: job.props, frame, output, logLevel: "warn" });
      stills.push(output);
      send({ type: "progress", stage: "stills", progress: stills.length / job.frames.length });
    }
    writeFileSync(path.join(job.outDir, "stills.json"), JSON.stringify(stills));
    send({ type: "done", stills });
  }
} catch (err) {
  send({ type: "error", message: String(err?.stack ?? err) });
  process.exitCode = 1;
}
