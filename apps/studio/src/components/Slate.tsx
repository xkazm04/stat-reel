import type { ReactNode } from "react";

/** The idle slate: bars in the status + ident tokens, a labelled reason, nothing invented. */
export function Slate({ title, lines, kicker = "NO PROGRAMME" }: { title: string; lines: ReactNode; kicker?: string }) {
  return (
    <div className="slate">
      <div className="slate__bars" aria-hidden="true">
        <i style={{ background: "var(--color-screen-ink)" }} />
        <i style={{ background: "var(--color-signal)" }} />
        <i style={{ background: "var(--status-data-ready)" }} />
        <i style={{ background: "var(--lane-3)" }} />
        <i style={{ background: "var(--lane-6)" }} />
        <i style={{ background: "var(--color-screen-ink-2)" }} />
        <i style={{ background: "var(--color-floodlight)" }} />
      </div>
      <div className="slate__body">
        <p className="slate__k">{kicker}</p>
        <p className="slate__t">{title}</p>
        <div className="slate__s">{lines}</div>
      </div>
    </div>
  );
}
