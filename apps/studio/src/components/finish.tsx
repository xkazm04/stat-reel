/**
 * Shared instruments for the licence line (Photo Finish, ADR 009): the mode switch, a lane bar travelling toward
 * the clay line, source chips marked by licence class, the finish picture (one lane per required
 * kind, the line splitting what may cross in this mode) and the never-fetched (DNS) list.
 */
import type { CellStatus, HeatmapCell, Mode, Source } from "@statreel/schemas";
import { type CSSProperties, useId } from "react";
import { barEnd, bestSource, byClass, CLASS_ORDER, finishShare, isShort, LINE } from "../finishline";
import { MODE_LABEL } from "../logic";
import { kindLong, LICENCE_WORD } from "../display";

const css = (o: Record<string, string | number>): CSSProperties => o as CSSProperties;

// ------------------------------------------------------------------ mode switch

type KeyLike = { key: string; preventDefault: () => void; currentTarget: { querySelector: (s: string) => unknown } | null };

/**
 * Arrow keys flip the mode and move focus to the newly checked radio (the radiogroup's roving stop).
 * The group is read while the listener runs: React resets `currentTarget` to null once the listener
 * returns, so reading it inside the frame callback threw and focus stayed on the unchecked radio.
 */
export function modeKeyDown(
  mode: Mode,
  onChange: (m: Mode) => void,
  raf: (cb: () => void) => unknown = (cb) => window.requestAnimationFrame(cb),
) {
  return (e: KeyLike) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    const group = e.currentTarget;
    const next: Mode = mode === "monetized" ? "non_commercial" : "monetized";
    onChange(next);
    raf(() => (group?.querySelector(`[data-mode="${next}"]`) as HTMLElement | null)?.focus());
  };
}

/**
 * The mode switch: the control that moves the line (a sliding key with the clay hairline at its
 * edge). `testid` adds mode-<m> test ids (use on one switch per page only).
 */
export function ModeSwitch({
  mode,
  onChange,
  label = "Mode",
  testid = false,
  className = "",
}: {
  mode: Mode;
  onChange: (m: Mode) => void;
  label?: string;
  testid?: boolean;
  className?: string;
}) {
  const id = useId();
  const opts: Mode[] = ["monetized", "non_commercial"];
  return (
      <div
        className={`pf-seg ${className}`}
        data-mode={mode}
        role="radiogroup"
        aria-labelledby={id}
        onKeyDown={modeKeyDown(mode, onChange)}
      >
        <span className="pf-seg__label" id={id}>
          {label}
        </span>
        <span className="pf-seg__track">
          {opts.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              className="pf-seg__opt"
              data-mode={m}
              aria-checked={mode === m}
              tabIndex={mode === m ? 0 : -1}
              data-testid={testid ? `mode-${m}` : undefined}
              onClick={() => onChange(m)}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </span>
      </div>
    );
}

// ------------------------------------------------------------------ lane bar

/** A bar travelling toward the line; its end is the status (Go crosses with a flag). */
export function LaneBar({
  cell,
  status,
  className = "",
}: {
  cell: Pick<HeatmapCell, "kinds" | "mode">;
  status: CellStatus;
  className?: string;
}) {
  return (
    <span
      className={`lb ${className}`}
      data-status={status}
      style={css({ "--end": `${barEnd(cell, status)}%`, "--line": `${LINE[cell.mode]}%` })}
      aria-hidden="true"
    >
      <span className="lb-rail" />
      <span className="lb-bar" />
      <span className="lb-line" />
    </span>
  );
}

// ------------------------------------------------------------------ source chip

/** A source id with its licence-class marker (disc legal, ring NC, diamond paid, cross avoid). */
export function SourceChip({
  id,
  cls,
  best = false,
  short = false,
  licence,
  status,
}: {
  id: string;
  cls: string;
  best?: boolean;
  short?: boolean;
  /** licence text from the registry, shown under the id */
  licence?: string | null;
  /** capability test status (pass / fail / declared / needs_review) */
  status?: string;
}) {
  return (
    <span className={`src-chip src-chip--${cls}${best ? " is-best" : ""}${short ? " is-short" : ""}`}>
      <i className="src-chip__m" aria-hidden="true" />
      <span className="src-chip__body">
        <span className="src-chip__row">
          <span className="src-chip__id">{id}</span>
          {best ? <span className="src-chip__best">best</span> : null}
          {status ? <span className={`src-chip__test src-chip__test--${status}`}>{testWord(status)}</span> : null}
        </span>
        <span className="sr-only">{LICENCE_WORD[cls as keyof typeof LICENCE_WORD] ?? cls}</span>
        {licence ? <span className="src-chip__lic">{licence}</span> : null}
      </span>
    </span>
  );
}

export function testWord(status: string): string {
  if (status === "pass") return "pass";
  if (status === "declared") return "declared, not tested";
  if (status === "needs_review") return "needs review";
  if (status === "fail") return "fail";
  return status;
}

// ------------------------------------------------------------------ finish picture

/**
 * One lane per required kind; columns paid / non-commercial / legal left to right; the hatched
 * side before the clay line is what does not cross in this mode.
 */
export function FinishPicture({
  cell,
  sources,
  className = "",
}: {
  cell: HeatmapCell;
  sources: Source[];
  className?: string;
}) {
  const reg = new Map(sources.map((s) => [s.id, s]));
  return (
    <div
      className={`fp ${className}`}
      data-mode={cell.mode}
      style={css({ "--fp-share": finishShare(cell.mode).toFixed(4) })}
    >
      <div className="fp-head" aria-hidden="true">
        <span>Required kind</span>
        <span>Paid</span>
        <span>Non-commercial</span>
        <span>Legal</span>
      </div>
      <div className="fp-lanes" role="table" aria-label={`Sources per required kind, ${MODE_LABEL[cell.mode]}`}>
        <div className="fp-short" aria-hidden="true" />
        {cell.kinds.map((k, i) => {
          const best = bestSource(k);
          const cols = byClass(k.sources);
          return (
            <div className="fp-lane" role="row" key={k.kind}>
              <div className="fp-kind" role="rowheader">
                <span className="fp-lane-no">Lane {i + 1}</span>
                <b>{kindLong(k.kind)}</b>
                <code>
                  {k.kind} · {k.tested ? "tested" : "not tested"}
                </code>
              </div>
              {CLASS_ORDER.map((c) => (
                <div className="fp-cell" role="cell" data-class={c} key={c}>
                  {c === "paid" || c === "non_commercial" || c === "legal"
                    ? cols[c].map((s) => (
                        <SourceChip
                          key={s.id}
                          id={s.id}
                          cls={c}
                          best={s.id === best}
                          short={isShort(c, cell.mode)}
                          status={s.status}
                          licence={reg.get(s.id)?.license ?? "not in the registry"}
                        />
                      ))
                    : null}
                </div>
              ))}
            </div>
          );
        })}
        <div className="fp-line" aria-hidden="true">
          <span className="fp-line-tag">Licence line · {MODE_LABEL[cell.mode].toLowerCase()}</span>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ never fetched

/** Sources that never start (verdict avoid): id, licence and the registry's own note, verbatim. */
export function DnsList({ sources, empty }: { sources: Source[]; empty: string }) {
  if (!sources.length) return <p className="dns-none">{empty}</p>;
  return (
    <ul className="dns">
      {sources.map((s) => (
        <li key={s.id} className="dns-item">
          <i className="src-chip__m src-chip__m--avoid" aria-hidden="true" />
          <span className="dns-id">
            {s.id} <span className="dns-tag">never fetched</span>
          </span>
          <span className="dns-why">
            {[s.license, s.notes, s.verdict_note ? `verdict note: ${s.verdict_note}` : null].filter(Boolean).join(" · ")}
          </span>
        </li>
      ))}
    </ul>
  );
}
