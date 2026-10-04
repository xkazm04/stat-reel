/**
 * The Front's inline Retry: an in-place error (a text line, not a whole Failure card) gets the same
 * button as ui.tsx `Failure`, wired to the query's refetch (ADR 012: a failed load is never a
 * dead end). `busy` shows the refetch in flight.
 */
export function RetryButton({ onRetry, busy = false }: { onRetry: () => void; busy?: boolean }) {
  return (
    <button type="button" className="btn btn--sm failure__retry" onClick={onRetry} disabled={busy} aria-busy={busy}>
      {busy ? "Retrying" : "Retry"}
    </button>
  );
}
