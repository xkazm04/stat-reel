/**
 * The Front's inline Retry: an in-place error (a text line, not a whole Failure card) gets the same
 * button as ui.tsx `Failure`, wired to the query's refetch (ADR 012: a failed load is never a
 * dead end). `busy` shows the refetch in flight.
 */
/**
 * The click retries and goes no further: a Retry can sit inside a way that is itself a router Link
 * (the Front's "Open the rundown"), and a bubbled click made that Link navigate away instead.
 */
export const retryClick =
  (onRetry: () => void) =>
  (e: { preventDefault: () => void; stopPropagation: () => void }): void => {
    e.preventDefault();
    e.stopPropagation();
    onRetry();
  };

export function RetryButton({ onRetry, busy = false }: { onRetry: () => void; busy?: boolean }) {
  return (
    <button type="button" className="btn btn--sm failure__retry" onClick={retryClick(onRetry)} disabled={busy} aria-busy={busy}>
      {busy ? "Retrying" : "Retry"}
    </button>
  );
}
