/**
 * The log drawer's read loop (D.11): GET the run log from an offset every `every` ms, appending what comes
 * back, and stop once the job is over (not queued or running) and a read comes back empty: the log is then
 * read to its end and nothing will be appended. Framework-free so the loop is testable (logtail.test.ts); LogDrawer.tsx binds it to React.
 */

/** Live jobs still write their log; an unknown status (the job is still loading) is not the end either. */
export const jobLive = (status: string | undefined): boolean => status === undefined || status === "queued" || status === "running";

export type LogRead = (offset: number) => Promise<{ text: string; next: number }>;

export function tailLog(o: {
  read: LogRead;
  /** the job's status as known now (undefined while it loads) */
  status: () => string | undefined;
  onText: (text: string) => void;
  every: number;
}): () => void {
  let stop = false;
  let offset = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pull = async () => {
    // sampled BEFORE the read: a job that ended during it still gets one more read for its last lines
    const live = jobLive(o.status());
    let more = true;
    try {
      const r = await o.read(offset);
      if (stop) return;
      if (r.text) o.onText(r.text);
      offset = r.next;
      more = live || r.text.length > 0;
    } catch {
      /* the next tick retries */
    }
    if (!stop && more) timer = setTimeout(pull, o.every);
  };
  void pull();
  return () => {
    stop = true;
    clearTimeout(timer);
  };
}
