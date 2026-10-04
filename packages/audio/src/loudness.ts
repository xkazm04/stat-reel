/**
 * Loudness measurement and normalisation via ffmpeg (EBU R128). Targets from DESIGN §6.3/§6.4:
 * −14 LUFS integrated ±1, true peak ≤ −2 dBTP, loudness range recorded.
 * Binaries: env FFMPEG_PATH / FFPROBE_PATH, else `ffmpeg` / `ffprobe` on PATH.
 */
import { execFile } from "node:child_process";

export interface Loudness {
  integratedLufs: number;
  truePeakDbtp: number;
  loudnessRangeLu: number;
}

const ffmpegBin = () => process.env.FFMPEG_PATH || "ffmpeg";
const ffprobeBin = () => process.env.FFPROBE_PATH || "ffprobe";

/** Lets the job's cancel reach ffmpeg (DESIGN 6.3): an aborted run rejects with the signal's reason. */
export interface CancelOptions {
  signal?: AbortSignal | undefined;
}

type RunResult = { stdout: string; stderr: string };

function run(bin: string, signal: AbortSignal | undefined, args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const opts = { maxBuffer: 64 * 1024 * 1024, windowsHide: true, ...(signal ? { signal } : {}) };
    execFile(bin, args, opts, (err, stdout, stderr) => {
      if (signal?.aborted) reject(signal.reason);
      else if (err) {
        const tail = String(stderr).trim().split(/\r?\n/).slice(-6).join("\n");
        reject(new Error(`${bin} failed (${err.message.split(/\r?\n/)[0]}): ${tail}`));
      } else resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

const num = (s: string) =>
  s === "-inf" ? Number.NEGATIVE_INFINITY : s === "inf" ? Number.POSITIVE_INFINITY : Number(s);

/** Parse the `Summary:` block that ffmpeg's ebur128 filter prints to stderr. */
export function parseEbur128Summary(stderr: string): Loudness {
  const at = stderr.lastIndexOf("Summary:");
  if (at < 0) throw new Error("ffmpeg ebur128: no Summary block in output");
  const s = stderr.slice(at);
  const pick = (re: RegExp, what: string) => {
    const m = re.exec(s);
    if (!m?.[1]) throw new Error(`ffmpeg ebur128: could not parse ${what}`);
    return num(m[1]);
  };
  return {
    integratedLufs: pick(/I:\s+(-?[\d.]+|-inf)\s+LUFS/, "integrated loudness"),
    loudnessRangeLu: pick(/LRA:\s+(-?[\d.]+|-?inf)\s+LU\b/, "loudness range"),
    truePeakDbtp: pick(/Peak:\s+(-?[\d.]+|-inf)\s+dBFS/, "true peak"),
  };
}

/** EBU R128 integrated loudness, true peak (ebur128 peak=true) and loudness range. */
export async function measureLoudness(file: string, opts: CancelOptions = {}): Promise<Loudness> {
  const { stderr } = await run(ffmpegBin(), opts.signal, [
    "-hide_banner",
    "-nostats",
    "-nostdin",
    "-i",
    file,
    "-map",
    "0:a:0",
    "-af",
    "ebur128=peak=true:framelog=verbose",
    "-f",
    "null",
    "-",
  ]);
  return parseEbur128Summary(stderr);
}

/** Container duration in seconds (ffprobe). */
export async function probeDurationS(file: string, opts: CancelOptions = {}): Promise<number> {
  const args = ["-v", "error", "-show_entries", "format=duration", "-of", "json", file];
  const { stdout } = await run(ffprobeBin(), opts.signal, args);
  const d = Number((JSON.parse(stdout) as { format?: { duration?: string } }).format?.duration);
  if (!Number.isFinite(d)) throw new Error(`ffprobe: no duration for ${file}`);
  return d;
}

async function probeSampleRate(file: string, signal?: AbortSignal): Promise<number | undefined> {
  const { stdout } = await run(ffprobeBin(), signal, [
    "-v",
    "error",
    "-select_streams",
    "a:0",
    "-show_entries",
    "stream=sample_rate",
    "-of",
    "json",
    file,
  ]);
  const sr = Number((JSON.parse(stdout) as { streams?: { sample_rate?: string }[] }).streams?.[0]?.sample_rate);
  return Number.isFinite(sr) && sr > 0 ? sr : undefined;
}

interface LoudnormStats {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
  normalization_type?: string;
}

function parseLoudnormJson(stderr: string): LoudnormStats {
  const start = stderr.lastIndexOf("{");
  const end = stderr.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("ffmpeg loudnorm: no JSON block in output");
  return JSON.parse(stderr.slice(start, end + 1)) as LoudnormStats;
}

export interface NormalizeOptions extends CancelOptions {
  input: string;
  output: string;
  targetLufs?: number;
  truePeak?: number;
  /** loudness-range target; raised to the measured LRA so linear mode stays possible */
  lra?: number;
  /** extra output args, e.g. ["-c:a", "libmp3lame", "-b:a", "192k"]; default: ffmpeg's choice by extension */
  codecArgs?: string[];
}

export interface NormalizeResult {
  before: Loudness;
  after: Loudness;
  /** "linear" = pure gain; "dynamic" = loudnorm had to compress to honour the peak limit */
  normalizationType: string;
}

/** Two-pass loudnorm: measure, then apply with the measured values (linear=true). */
export async function normalizeTo(opts: NormalizeOptions): Promise<NormalizeResult> {
  const I = opts.targetLufs ?? -14;
  const TP = opts.truePeak ?? -2;
  const base = ["-hide_banner", "-nostats", "-nostdin", "-y", "-i", opts.input, "-map", "0:a:0"];

  const pass1 = await run(ffmpegBin(), opts.signal, [
    ...base,
    "-af",
    `loudnorm=I=${I}:TP=${TP}:LRA=${opts.lra ?? 11}:print_format=json`,
    "-f",
    "null",
    "-",
  ]);
  const m = parseLoudnormJson(pass1.stderr);
  const before: Loudness = {
    integratedLufs: num(m.input_i),
    truePeakDbtp: num(m.input_tp),
    loudnessRangeLu: num(m.input_lra),
  };
  if (!Number.isFinite(before.integratedLufs) || before.integratedLufs <= -70)
    throw new Error(`normalizeTo: ${opts.input} is silent (integrated ${m.input_i} LUFS); nothing to normalise`);

  const lra = Math.min(50, Math.max(opts.lra ?? 11, Math.ceil(before.loudnessRangeLu) + 1));
  const filter = [
    `loudnorm=I=${I}`,
    `TP=${TP}`,
    `LRA=${lra}`,
    `measured_I=${m.input_i}`,
    `measured_TP=${m.input_tp}`,
    // loudnorm treats measured_LRA=0 (its default) as "not measured" and silently falls back to
    // dynamic mode; a genuinely flat input (e.g. a test tone) measures 0.00, so floor it
    `measured_LRA=${Math.max(0.01, num(m.input_lra))}`,
    `measured_thresh=${m.input_thresh}`,
    `offset=${m.target_offset}`,
    "linear=true",
    "print_format=json",
  ].join(":");
  // loudnorm upsamples to 192 kHz internally; keep the input rate
  const sr = await probeSampleRate(opts.input, opts.signal);
  const pass2 = await run(ffmpegBin(), opts.signal, [
    ...base,
    "-af",
    filter,
    ...(sr ? ["-ar", String(sr)] : []),
    ...(opts.codecArgs ?? []),
    opts.output,
  ]);
  const normalizationType = parseLoudnormJson(pass2.stderr).normalization_type ?? "unknown";
  const after = await measureLoudness(opts.output, opts);
  return { before, after, normalizationType };
}
