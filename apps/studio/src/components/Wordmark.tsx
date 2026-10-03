/**
 * The wordmark (ADR 009): the Frame Stat icon, then STAT | REEL split by the clay-red finish line
 * (data before it, video after it). The typography is unchanged; the icon is a decorative sibling
 * before STAT (the enclosing link carries the accessible name).
 */
import { FrameStatMark } from "./FrameStatMark";

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`pf-mark ${className}`.trim()} aria-hidden="true">
      <FrameStatMark className="pf-mark__icon" />
      <span className="pf-mark__a">STAT</span>
      <span className="pf-mark__l" />
      <span className="pf-mark__b">REEL</span>
    </span>
  );
}
