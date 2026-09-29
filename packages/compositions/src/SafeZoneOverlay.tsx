/** Debug overlay: tinted platform-UI danger regions, the critical box and the caption box. */
import { captionBox } from "@statreel/captions";
import type { Format } from "@statreel/schemas";
import type { ReactElement } from "react";
import { criticalBox } from "./layout";

const DANGER = "rgba(255, 0, 110, 0.28)";
const OUTLINE = "rgba(0, 240, 200, 0.95)";
const CAPTION = "rgba(120, 170, 255, 0.95)";

export function SafeZoneOverlay({ format }: { format: Format }): ReactElement {
  const W = format === "vertical" ? 1080 : 1920;
  const H = format === "vertical" ? 1920 : 1080;
  const c = criticalBox(format);
  const cap = captionBox(format);
  const right = c.x + c.width;
  const bottom = c.y + c.height;
  return (
    <svg
      data-safe-zone=""
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}
      aria-hidden="true"
    >
      <rect x={0} y={0} width={W} height={c.y} fill={DANGER} />
      <rect x={0} y={bottom} width={W} height={H - bottom} fill={DANGER} />
      <rect x={0} y={c.y} width={c.x} height={c.height} fill={DANGER} />
      <rect x={right} y={c.y} width={W - right} height={c.height} fill={DANGER} />
      <rect
        x={c.x}
        y={c.y}
        width={c.width}
        height={c.height}
        fill="none"
        stroke={OUTLINE}
        strokeWidth={3}
        strokeDasharray="14 8"
      />
      <rect
        x={cap.x}
        y={cap.y}
        width={cap.width}
        height={cap.maxHeight}
        fill="none"
        stroke={CAPTION}
        strokeWidth={2}
        strokeDasharray="6 6"
      />
      <text x={c.x + 6} y={c.y - 10} fill={OUTLINE} fontFamily="JetBrains Mono" fontSize={22}>
        {`CRITICAL ${c.width}×${c.height}`}
      </text>
    </svg>
  );
}
