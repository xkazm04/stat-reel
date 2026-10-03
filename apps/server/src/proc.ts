/**
 * Process-tree helpers for the generation worker (ADR 010). Never shells out through a shell:
 * `taskkill` / `tasklist` / `ps` are spawned with an argument array.
 */
import { execFile } from "node:child_process";
import path from "node:path";

const run = (cmd: string, args: string[]): Promise<{ code: number; stdout: string }> =>
  new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 15_000 }, (err, stdout) => {
      const code = err && typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : err ? 1 : 0;
      resolve({ code, stdout: String(stdout ?? "") });
    });
  });

/** True when a process with this pid exists (signal 0 sends nothing). */
export function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Kill a process and its children. Resolves when the kill command returned; ESRCH/not-found is fine. */
export async function killTree(pid: number): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return;
  if (process.platform === "win32") {
    await run("taskkill", ["/PID", String(pid), "/T", "/F"]);
    return;
  }
  try {
    process.kill(-pid, "SIGKILL"); // children are spawned detached: the pid is the group id
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

/** The executable name of a running pid (lower-case, no extension), or null when it is not running. */
export async function imageName(pid: number): Promise<string | null> {
  if (!isAlive(pid)) return null;
  if (process.platform === "win32") {
    const { stdout } = await run("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]);
    const m = /^"([^"]+)"/.exec(stdout.trim());
    return m ? path.parse(m[1] as string).name.toLowerCase() : null;
  }
  const { stdout } = await run("ps", ["-o", "comm=", "-p", String(pid)]);
  const name = stdout.trim();
  return name ? path.parse(name).name.toLowerCase() : null;
}

/**
 * Kill a recorded pid only when it is still the process we spawned: recovery runs after a crash and
 * pids get reused, so a pid whose image name differs from `expectedName` is left alone.
 */
export async function killTreeIfNamed(pid: number, expectedName: string): Promise<boolean> {
  const name = await imageName(pid);
  if (name === null || name !== expectedName.toLowerCase()) return false;
  await killTree(pid);
  return true;
}
