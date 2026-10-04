/**
 * The status vocabulary, drawn (the font subsets carry no arrows): status glyphs (shape before
 * hue), status chips (glyph + label as text), licence chips, arrows.
 * The glyphs are Photo Finish positions relative to the finish line (bar across with a flag, bar
 * at the line with a hollow end, hatched bar short with a query dot, barred gate at the start).
 */
import type { CellStatus, LicenseClass } from "@statreel/schemas";
import type { ReactNode } from "react";
import { LICENCE_WORD, STATUS_WORD } from "../display";

export type GlyphKind = CellStatus;

/** Photo Finish status glyph: 36 x 16 units, the clay line at x = 26 (A/3 SR.glyph). */
export function LineGlyph({ status, size = 16 }: { status: GlyphKind; size?: number }) {
  const w = Math.round(size * 2.25 * 10) / 10;
  let body: ReactNode;
  if (status === "go")
    body = (
      <>
        <rect x="1" y="6" width="33" height="4.5" className="g-fill" />
        <path d="M33 6.2V.8l-5.2 2.4L33 5.6z" className="g-fill" />
        <rect x="32.6" y=".8" width="1.4" height="6" className="g-fill" />
      </>
    );
  else if (status === "data-ready")
    body = (
      <>
        <rect x="1" y="6" width="18.5" height="4.5" className="g-fill" />
        <circle cx="21.4" cy="8.25" r="3.4" className="g-hollow" />
      </>
    );
  else if (status === "ask")
    body = (
      <>
        <path d="M1.75 5.75H14l-2.2 2.5 2.2 2.5H1.75z" className="g-stroke" />
        <path d="M3.2 10.4l2.7-4.3M6.2 10.4l2.7-4.3M9.2 10.4l2.4-3.8" className="g-stroke" />
        <circle cx="18.3" cy="8.25" r="1.5" className="g-fill" />
      </>
    );
  else
    body = (
      <>
        <rect x="1.9" y="2.9" width="10.7" height="10.7" className="g-stroke" style={{ strokeWidth: 1.8 }} />
        <path d="M2 3l10.5 10.5M12.5 3L2 13.5" className="g-stroke" />
        <path d="M15.5 8.25h9" className="g-faint" />
      </>
    );
  return (
    <svg className={`glyph glyph--line glyph--${status}`} viewBox="0 0 36 16" width={w} height={size} aria-hidden="true">
      {body}
      <line x1="26" y1="0.5" x2="26" y2="15.5" className="g-line" />
    </svg>
  );
}

export function Glyph({ status, size = 16 }: { status: GlyphKind; size?: number }) {
  return <LineGlyph status={status} size={size} />;
}

/** Glyph + label. The label is literal text (GO / DATA READY / ASK / BLOCKED), never CSS-only. */
export function StatusChip({ status, size = 16, label }: { status: CellStatus; size?: number; label?: string }) {
  return (
    <span className={`st st--${status}`}>
      <Glyph status={status} size={size} />
      <span>{label ?? STATUS_WORD[status]}</span>
    </span>
  );
}

/** Pass / fail / declared / needs-review for a tested source: borrows the status shapes. */
export function TestChip({ status }: { status: string }) {
  const map: Record<string, { g: CellStatus; label: string }> = {
    pass: { g: "go", label: "PASS" },
    fail: { g: "blocked", label: "FAIL" },
    declared: { g: "data-ready", label: "DECLARED · NOT TESTED" },
    needs_review: { g: "ask", label: "NEEDS REVIEW" },
  };
  const m = map[status] ?? { g: "blocked" as CellStatus, label: status.toUpperCase() };
  return (
    <span className={`st st--sm st--${m.g}`}>
      <Glyph status={m.g} size={13} />
      <span>{m.label}</span>
    </span>
  );
}

export function LicChip({ cls }: { cls: string }) {
  const known = cls in LICENCE_WORD;
  return (
    <span className={`lic lic--${known ? cls : "unknown"}`}>{known ? LICENCE_WORD[cls as LicenseClass] : cls}</span>
  );
}

export function Arrow({ dir = "right", size = 16 }: { dir?: "right" | "left" | "up" | "down"; size?: number }) {
  const r = { right: 0, left: 180, up: -90, down: 90 }[dir];
  return (
    <svg
      width={size}
      height={Math.round((size * 12) / 16)}
      viewBox="0 0 16 12"
      aria-hidden="true"
      style={{ transform: `rotate(${r}deg)`, flex: "none" }}
    >
      <path
        d="M1 6h13M9.5 1.5 14 6l-4.5 4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="square"
      />
    </svg>
  );
}

export function FormatIcon({ format, h = 12 }: { format: string; h?: number }) {
  const w = format === "landscape" ? Math.round((h * 16) / 9) : Math.round((h * 9) / 16);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" style={{ flex: "none" }}>
      <rect x=".75" y=".75" width={w - 1.5} height={h - 1.5} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** "≠" drawn (the subsets carry no maths symbols). */
export function NotEqual() {
  return (
    <svg className="neq" viewBox="0 0 40 40" role="img" aria-label="is not">
      <path d="M5 14h30M5 26h30" stroke="currentColor" strokeWidth="5.5" />
      <path d="M27 4 13 36" stroke="currentColor" strokeWidth="5" />
    </svg>
  );
}

