/**
 * The StatReel icon, concept C "Frame Stat": a film frame with sprocket holes and four bars rising
 * inside. The geometry is the single shared source in `@statreel/design-tokens` (logo.ts); this
 * component only maps each rect role to a class (`.fsm__frame|hole|window|bar`, the tallest bar
 * also `.fsm__bar--lead`) and the colours live in photofinish.css. Decorative: the surrounding
 * link or heading carries the accessible name.
 */
import { FRAME_STAT_VIEWBOX, frameStatRects } from "@statreel/design-tokens";

const RECTS = frameStatRects(1);
const LEAD = RECTS.filter((r) => r.role === "bar").length - 1;

export function FrameStatMark({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`fsm ${className}`.trim()}
      viewBox={FRAME_STAT_VIEWBOX}
      aria-hidden="true"
      focusable="false"
      data-testid="frame-stat-mark"
    >
      {RECTS.map((r) => (
        <rect
          key={`${r.role}-${r.i}`}
          className={`fsm__${r.role}${r.role === "bar" && r.i === LEAD ? " fsm__bar--lead" : ""}`}
          x={r.x}
          y={r.y}
          width={r.w}
          height={r.h}
          rx={r.rx}
        />
      ))}
    </svg>
  );
}
