/**
 * Patchbay glyphs: LEDs (shape + label; colour is only the third channel), licence jacks, the
 * logo mark, format glyphs, screws. Colours come from tokens via CSS classes (app.css).
 */
import type { LicenseClass } from "@statreel/schemas";
import type { ReactNode } from "react";
import { type LedStatus, LICENCE_META, STATUS_META } from "../logic";

export function LedSvg({ status }: { status: LedStatus }) {
  const shape = STATUS_META[status].shape;
  let inner: ReactNode;
  if (shape === "go") inner = <circle className="glow" cx="7" cy="7" r="6" fill="currentColor" />;
  else if (shape === "data-ready")
    inner = (
      <>
        <circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path className="glow" d="M7 1.4a5.6 5.6 0 0 0 0 11.2z" fill="currentColor" />
      </>
    );
  else if (shape === "ask") inner = <path className="glow" d="M7 .8 13.4 12.6H.6z" fill="currentColor" />;
  else if (shape === "idle")
    inner = (
      <circle cx="7" cy="7" r="5.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="2 1.6" />
    );
  else
    inner = (
      <>
        <rect className="glow" x="1" y="1" width="12" height="12" rx="1.5" fill="currentColor" />
        <path className="led-slash" d="M3.4 10.6 10.6 3.4" strokeWidth="2.2" strokeLinecap="round" />
      </>
    );
  return (
    <svg viewBox="0 0 14 14" aria-hidden="true" focusable="false">
      {inner}
    </svg>
  );
}

/** LED glyph with its label. `label` overrides the default word (e.g. "ALLOW"). */
export function Led({
  status,
  label,
  hideLabel,
  className,
}: {
  status: LedStatus;
  label?: string;
  hideLabel?: boolean;
  className?: string;
}) {
  const meta = STATUS_META[status];
  return (
    <span className={`led st-${status}${className ? ` ${className}` : ""}`}>
      <LedSvg status={status} />
      {hideLabel ? (
        <span className="sr-only">{label ?? meta.word}</span>
      ) : (
        <span className="led-label">{label ?? meta.label}</span>
      )}
    </span>
  );
}

export function JackSvg({ cls }: { cls: LicenseClass | string }) {
  if (cls === "legal")
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <circle className="jack-ring" cx="8" cy="8" r="6.6" strokeWidth="1.6" />
        <circle className="jack-hole" cx="8" cy="8" r="2.8" />
      </svg>
    );
  if (cls === "non_commercial")
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <circle cx="8" cy="8" r="7.2" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="2 1.4" />
        <circle className="jack-ring" cx="8" cy="8" r="5.4" strokeWidth="2.4" />
        <circle className="jack-hole" cx="8" cy="8" r="2.2" />
      </svg>
    );
  if (cls === "paid")
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <circle className="jack-ring" cx="8" cy="8" r="6.6" strokeWidth="1.6" />
        <circle className="jack-hole" cx="8" cy="8" r="2.8" />
        <rect x="7" y="1" width="2" height="4" fill="currentColor" />
      </svg>
    );
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="7" fill="currentColor" />
      <path className="jack-cap" d="M5 5l6 6M11 5l-6 6" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** Licence jack: glyph + optional source id + class tag (text, never colour alone). */
export function Jack({
  cls,
  id,
  noTag,
  strike,
}: {
  cls: LicenseClass | string;
  id?: string;
  noTag?: boolean;
  strike?: boolean;
}) {
  const meta = LICENCE_META[cls as LicenseClass] ?? { label: String(cls).toUpperCase(), word: String(cls) };
  return (
    <span className={`jack lic-${cls}`}>
      <JackSvg cls={cls} />
      {id ? <span className={`mono jack-id${strike ? " struck" : ""}`}>{id}</span> : null}
      {noTag ? null : <span className={`lic lic-${cls}`}>{meta.label}</span>}
    </span>
  );
}

export function LogoMark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false" className="logo">
      <circle className="logo-ring" cx="16" cy="16" r="13.5" strokeWidth="3" />
      <circle className="logo-hole" cx="16" cy="16" r="7.2" />
      <circle className="logo-dot" cx="18.6" cy="13.4" r="3.1" />
      <path className="logo-stem" d="M16 29.5v2.5" strokeWidth="3" />
    </svg>
  );
}

export function FormatGlyph({ format }: { format: string }) {
  const v = format === "vertical";
  return (
    <span className="fmt-glyph">
      <svg viewBox="0 0 18 18" aria-hidden="true" focusable="false" width="14" height="14">
        {v ? (
          <rect x="5" y="1.5" width="8" height="15" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        ) : (
          <rect x="1.5" y="4.5" width="15" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        )}
      </svg>
      <span className="mono">{v ? "9:16" : "16:9"}</span>
    </span>
  );
}

export function Screws({ at = ["tl", "tr", "bl", "br"] }: { at?: ("tl" | "tr" | "bl" | "br")[] }) {
  return (
    <>
      {at.map((p) => (
        <span key={p} className={`screw ${p}`} aria-hidden="true" />
      ))}
    </>
  );
}

export function KindPin({ kind, partial }: { kind: string; partial?: boolean }) {
  return <span className={`kind-pin${partial ? " partial" : ""}`}>{partial ? `${kind} · partial` : kind}</span>;
}

export function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null;
  const W = 60;
  const H = 18;
  const max = Math.max(1, ...values);
  const pts = values
    .map((v, i) => `${((i / (values.length - 1)) * W).toFixed(1)},${(H - 2 - (v / max) * (H - 4)).toFixed(1)}`)
    .join(" ");
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label}>
      <polyline points={pts} fill="none" strokeWidth="1.6" />
    </svg>
  );
}
