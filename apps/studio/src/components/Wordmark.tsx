/**
 * The wordmark (ADR 009): STAT | REEL split by the clay-red finish line (data before it, video
 * after it).
 */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`pf-mark ${className}`} aria-hidden="true">
      <span className="pf-mark__a">STAT</span>
      <span className="pf-mark__l" />
      <span className="pf-mark__b">REEL</span>
    </span>
  );
}
