/**
 * Process lifecycle for serve.ts (DESIGN §3): graceful SIGINT/SIGTERM shutdown and last-resort
 * process handlers. Separate from serve.ts so the order of steps is unit-testable with fakes.
 */
export type ShutdownParts = {
  /** stop accepting connections; resolves when open ones are gone */
  closeServer: () => Promise<void>;
  /** abort running jobs with cause "shutdown" and await them */
  stopJobs: () => Promise<unknown>;
  /** stoppers for timers/relays (called first, failures logged) */
  stoppers?: (() => void)[];
  /** close the DB with a WAL checkpoint */
  closeDb: () => void;
  log?: (msg: string) => void;
  /** upper bound on closing the server; SSE streams never end by themselves */
  serverGraceMs?: number;
};

export function makeShutdown(p: ShutdownParts): () => Promise<void> {
  const log = p.log ?? ((m) => console.log(`[shutdown] ${m}`));
  let running: Promise<void> | undefined;
  const step = async (name: string, fn: () => unknown) => {
    try {
      await fn();
    } catch (err) {
      log(`${name} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  return () =>
    (running ??= (async () => {
      for (const s of p.stoppers ?? []) await step("stopper", s);
      // stop listening first, but do not wait on SSE streams: jobs must be aborted regardless
      const closed = step("close server", p.closeServer);
      await step("stop jobs", p.stopJobs);
      await Promise.race([closed, new Promise((r) => setTimeout(r, p.serverGraceMs ?? 2000).unref())]);
      await step("close db", p.closeDb);
      log("done");
    })());
}

/** Installs signal + last-resort handlers. `exit` is injectable for tests. */
export function installProcessHandlers(shutdown: () => Promise<void>, opts: { proc?: Pick<NodeJS.Process, "on">; exit?: (code: number) => void; log?: (msg: string) => void } = {}): void {
  const proc = opts.proc ?? process;
  const exit = opts.exit ?? ((c: number) => process.exit(c));
  const log = opts.log ?? ((m: string) => console.error(m));
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    proc.on(sig, () => {
      log(`[shutdown] ${sig}`);
      void shutdown().finally(() => exit(0));
    });
  }
  proc.on("unhandledRejection", (reason) => {
    // keep serving: one failed background promise must not take the owner's dev server down
    log(`[process] UNHANDLED REJECTION: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`);
  });
  proc.on("uncaughtException", (err) => {
    log(`[process] UNCAUGHT EXCEPTION: ${err.stack ?? err.message}`);
    // process state is undefined after this: shut down in an orderly way, then exit non-zero
    void shutdown().finally(() => exit(1));
  });
}
