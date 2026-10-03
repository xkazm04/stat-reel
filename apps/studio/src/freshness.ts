/**
 * Tab freshness (client-fetch-cache): SSE (events.ts) is the live path, but a dropped connection
 * or a sleeping laptop leaves cached data of unbounded age and the stream does not replay what it
 * missed. So when the tab comes back after being hidden for a while, or the browser regains its
 * network, every ACTIVE query is invalidated (inactive ones refetch on their next mount anyway).
 * A short blur (alt-tab to copy a value) refetches nothing, which is why the library's own
 * refetchOnWindowFocus stays off. The deciding rule is a pure function; the DOM wiring is one
 * small installer (main.tsx). Unit-tested in freshness.test.ts.
 */
import type { QueryClient } from "@tanstack/react-query";

/** Hidden at least this long -> the SSE stream may have missed events (a heartbeat is ~15-30 s). */
export const HIDDEN_REFRESH_MS = 30_000;

/**
 * Should coming back to the tab refetch? `hiddenSince` is the timestamp the tab went hidden
 * (null when it never did since load), `now` the current one; both in ms.
 */
export function shouldRefreshOnVisible(hiddenSince: number | null, now: number, thresholdMs = HIDDEN_REFRESH_MS): boolean {
  if (hiddenSince === null) return false;
  return now - hiddenSince >= thresholdMs;
}

/** Wire the listeners; returns the cleanup. Time and the document are injectable for tests. */
export function installFreshness(
  qc: Pick<QueryClient, "invalidateQueries">,
  target: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener"> = document,
  win: Pick<Window, "addEventListener" | "removeEventListener"> = window,
  clock: () => number = Date.now,
): () => void {
  let hiddenSince: number | null = null;
  const refresh = () => void qc.invalidateQueries({ refetchType: "active" });
  const onVisibility = () => {
    if (target.visibilityState === "hidden") {
      hiddenSince ??= clock();
      return;
    }
    const since = hiddenSince;
    hiddenSince = null;
    if (shouldRefreshOnVisible(since, clock())) refresh();
  };
  target.addEventListener("visibilitychange", onVisibility);
  win.addEventListener("online", refresh);
  return () => {
    target.removeEventListener("visibilitychange", onVisibility);
    win.removeEventListener("online", refresh);
  };
}
