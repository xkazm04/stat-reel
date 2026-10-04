/**
 * Publish gate runner: evaluates `policy/publish.rego` with the real `opa` binary.
 * Input goes in on stdin (`opa eval --stdin-input`), so manifests never touch a temp file.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type PolicyResult, PolicyResultSchema } from "@statreel/schemas";

export interface EvaluatePolicyOptions {
  /** path to the opa binary; default `defaultOpaBin()` (OPA_BIN, else `<repo>/.tools/opa[.exe]`, else `opa`) */
  opaBin?: string;
  /** directory holding publish.rego; default `<repo>/policy` */
  policyDir?: string;
  /** kill opa after this many ms (default 30 s) */
  timeoutMs?: number;
}

export const POLICY_QUERY =
  'result := {"allow": data.statreel.publish.allow, "deny": data.statreel.publish.deny, "warn": data.statreel.publish.warn, "checks_run": data.statreel.publish.checks_run}';

/** Walk up from this file to the workspace root (the dir with pnpm-workspace.yaml). */
export function repoRoot(start: string = dirname(fileURLToPath(import.meta.url))): string {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`repo root not found above ${start}`);
    dir = parent;
  }
}

/**
 * `OPA_BIN`, else the binary `just setup` installs (`<repo>/.tools/opa[.exe]`, the one scripts/check.mjs runs),
 * else `opa` on PATH - the PATH fallback only off Windows and only when nothing is installed.
 */
export function defaultOpaBin(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  root?: string,
): string {
  if (env.OPA_BIN) return env.OPA_BIN;
  const local = join(root ?? repoRoot(), ".tools", platform === "win32" ? "opa.exe" : "opa");
  return platform === "win32" || existsSync(local) ? local : "opa";
}

export class PolicyEvaluationError extends Error {
  constructor(
    message: string,
    readonly stderr = "",
  ) {
    super(stderr ? `${message}: ${stderr.trim()}` : message);
    this.name = "PolicyEvaluationError";
  }
}

/** Build the argv for `opa eval` (exported for tests). Test files are excluded from loading. */
export function opaArgs(policyDir: string): string[] {
  return ["eval", "--format", "json", "--stdin-input", "--data", policyDir, "--ignore", "*_test.rego", POLICY_QUERY];
}

/**
 * Evaluate the publish gate. Fails closed: any opa error, timeout, undefined result or
 * schema mismatch rejects - it never resolves to `allow: true` by accident.
 */
export async function evaluatePolicy(
  manifest: unknown,
  target: unknown,
  options: EvaluatePolicyOptions = {},
): Promise<PolicyResult> {
  const opaBin = options.opaBin ?? defaultOpaBin();
  const policyDir = resolve(options.policyDir ?? join(repoRoot(), "policy"));
  const input = JSON.stringify({ manifest, target });
  const { stdout, stderr, code } = await run(opaBin, opaArgs(policyDir), input, options.timeoutMs ?? 30_000);
  if (code !== 0) throw new PolicyEvaluationError(`opa eval exited with ${code}`, stderr);
  return parseOpaOutput(stdout);
}

/** Parse `opa eval --format json` output for POLICY_QUERY into a PolicyResult. */
export function parseOpaOutput(stdout: string): PolicyResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new PolicyEvaluationError("opa output is not JSON", stdout.slice(0, 500));
  }
  const bindings = (parsed as { result?: Array<{ bindings?: { result?: unknown } }> }).result?.[0]?.bindings?.result;
  if (bindings === undefined) throw new PolicyEvaluationError("opa query result is undefined (policy not loaded?)");
  const result = PolicyResultSchema.parse(bindings);
  // Sets come back as arrays in arbitrary order; sort for stable output.
  return { ...result, deny: [...result.deny].sort(), warn: [...result.warn].sort() };
}

function run(bin: string, args: string[], stdin: string, timeoutMs: number) {
  return new Promise<{ stdout: string; stderr: string; code: number | null }>((resolvePromise, reject) => {
    const child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new PolicyEvaluationError(`opa eval timed out after ${timeoutMs} ms`, stderr));
    }, timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (d: string) => {
      stdout += d;
    });
    child.stderr.setEncoding("utf8").on("data", (d: string) => {
      stderr += d;
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new PolicyEvaluationError(`cannot run opa (${bin}): ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ stdout, stderr, code });
    });
    child.stdin.on("error", () => {
      /* reported via close/error */
    });
    child.stdin.end(stdin, "utf8");
  });
}
