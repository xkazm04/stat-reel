/**
 * The wordmark, drawn per theme: On Air's slanted volt mark + STATREEL; Photo Finish's
 * STAT | REEL split by the clay-red finish line (data before it, video after it).
 */
import { useTheme } from "../theme";
import { Mark } from "./glyphs";

export function Wordmark({ className = "" }: { className?: string }) {
  const { theme } = useTheme();
  if (theme === "photofinish")
    return (
      <span className={`pf-mark ${className}`} aria-hidden="true">
        <span className="pf-mark__a">STAT</span>
        <span className="pf-mark__l" />
        <span className="pf-mark__b">REEL</span>
      </span>
    );
  return (
    <span className={`oa-mark ${className}`} aria-hidden="true">
      <Mark />
      <span className="logo__word">
        STAT<b>REEL</b>
      </span>
    </span>
  );
}
