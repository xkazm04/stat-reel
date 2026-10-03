/**
 * Variant 2 · Light table. Triage, one shot at a time: the current shot sits on the loupe as large
 * as the screen allows, the gate and its facts beside it, and the whole loop runs underneath as a
 * contact sheet (a filmstrip with frame numbers and grease-pencil marks: a ring for accepted, a
 * cross for rejected, always with the word). Deciding advances to the next pending shot.
 * Keys: Left/Right walk the strip (the loupe follows), A / S / C / B decide, Enter jumps to the
 * gate, Esc returns to the strip. Best at: clearing a fresh loop fast and without losing context.
 */
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import type { BoardDecision, BoardItem } from "../api";
import { Arrow } from "../components/glyphs";
import type { VariantProps } from "./BoardPage";
import { caseOf, DECISION_META, itemState, linearMove, nextPending, styleOf } from "./board";
import { CaseChip, Gate, ItemFacts, Shot, StateMark, shotAlt, useAdvanceOnRemoval, useJumpKeys } from "./shared";

const frameNo = (i: number) => String(i + 1).padStart(2, "0");

export function LightTableVariant({ items, names }: VariantProps) {
  const firstPending = useMemo(
    () => items.find((i) => itemState(i) === "pending")?.id ?? items[0]?.id ?? null,
    [items],
  );
  const [cur, setCur] = useState<string | null>(null);
  const [advance, setAdvance] = useState(true);
  const [said, setSaid] = useState<{ title: string; decision: BoardDecision } | null>(null);
  const frames = useRef(new Map<string, HTMLButtonElement | null>());
  const gateRef = useRef<HTMLDivElement>(null);
  const currentId = cur && items.some((i) => i.id === cur) ? cur : firstPending;
  const idx = items.findIndex((i) => i.id === currentId);
  const item = idx >= 0 ? items[idx] : undefined;
  const decided = items.filter((i) => itemState(i) !== "pending").length;

  const go = (id: string, focusFrame = false) => {
    setCur(id);
    if (focusFrame) frames.current.get(id)?.focus();
  };

  const sectionRef = useRef<HTMLElement>(null);
  // J / K: next / previous pending shot (the loupe follows, the strip keeps focus)
  useJumpKeys(items, currentId, (id) => go(id, true), sectionRef);
  // a decision that removes the shot on the loupe (reject, or any decision under "pending") moves on to its neighbour
  useAdvanceOnRemoval(items, cur, (id) => go(id, true));

  // keep the current frame in view on the strip (horizontal scroll only: the page never jumps)
  useEffect(() => {
    const el = currentId ? frames.current.get(currentId) : null;
    const strip = el?.parentElement;
    if (!el || !strip) return;
    const left = el.offsetLeft - strip.offsetLeft;
    if (left < strip.scrollLeft || left + el.offsetWidth > strip.scrollLeft + strip.clientWidth)
      strip.scrollTo({ left: Math.max(0, left - (strip.clientWidth - el.offsetWidth) / 2) });
  }, [currentId]);

  const onStripKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter") {
      // the focused frame is already on the loupe (selection follows focus): Enter opens its gate
      e.preventDefault();
      gateRef.current?.querySelector<HTMLElement>("button.bd-dec")?.focus();
      return;
    }
    const to = linearMove(Math.max(0, idx), e.key, items.length);
    if (to === null) return;
    e.preventDefault();
    const next = items[to];
    if (next) go(next.id, true);
  };

  const onStageKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("input, textarea, select")) {
      if (e.key === "Escape") (e.target as HTMLElement).blur();
      return;
    }
    if (e.key === "Escape" && currentId) {
      e.preventDefault();
      frames.current.get(currentId)?.focus();
    } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && idx >= 0) {
      const to = linearMove(idx, e.key, items.length);
      const next = to === null ? undefined : items[to];
      if (next) {
        e.preventDefault();
        go(next.id);
      }
    }
  };

  const onDecided = (it: BoardItem, d: BoardDecision) => {
    setSaid({ title: it.title, decision: d });
    if (!advance) return;
    const nxt = nextPending(
      items.map((i) => (i.id === it.id ? it : i)),
      it.id,
    );
    if (nxt) go(nxt, true);
  };

  if (!item) return null;
  const style = styleOf(item);
  const kase = caseOf(item, names);

  return (
    <section className="bd-lt" aria-label="Light table" ref={sectionRef}>
      <div className="bd-lt__progress">
        <div className="bd-lt__meter" role="img" aria-label={`${decided} of ${items.length} shots in view decided`}>
          {items.map((i) => (
            <i
              key={i.id}
              className={`bd-lt__tick bd-lt__tick--${itemState(i)} ${i.id === currentId ? "is-cur" : ""}`}
            />
          ))}
        </div>
        <span className="num">
          <b>{decided}</b> of {items.length} decided · {items.length - decided} pending
        </span>
        <label className="bd-check">
          <input type="checkbox" checked={advance} onChange={(e) => setAdvance(e.target.checked)} />
          Advance to the next pending shot after deciding
        </label>
        <span className="bd-lt__said" aria-live="polite">
          {said ? (
            <>
              Recorded <b>{DECISION_META[said.decision].done}</b> · {said.title}
            </>
          ) : null}
        </span>
      </div>

      {/* biome-ignore lint/a11y/noStaticElementInteractions: Esc and arrows while the loupe or the gate has focus */}
      <div className="bd-lt__table" onKeyDown={onStageKey}>
        <figure className="bd-lt__loupe">
          <div className="bd-lt__frame">
            <Shot item={item} fit="box" alt={shotAlt(item)} eager />
          </div>
          <figcaption className="bd-lt__cap">
            <span className="mono">
              Frame {frameNo(idx)} / {frameNo(items.length - 1)}
            </span>
            <span className="bd-lt__steps">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={idx <= 0}
                onClick={() => {
                  const p = items[idx - 1];
                  if (p) go(p.id);
                }}
              >
                <Arrow dir="left" /> Previous
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={idx >= items.length - 1}
                onClick={() => {
                  const n = items[idx + 1];
                  if (n) go(n.id);
                }}
              >
                Next <Arrow />
              </button>
            </span>
          </figcaption>
        </figure>

        <aside className="bd-lt__side" aria-labelledby="bd-lt-title" ref={gateRef}>
          <p className="eyebrow">
            <i />
            Design output · not a result
          </p>
          <h2 className="bd-lt__title" id="bd-lt-title">
            {item.title}
          </h2>
          <p className="bd-lt__axes">
            <span className="bd-lt__axis">
              <span className="label">Style</span>
              <b>{style.name}</b>
            </span>
            <span className="bd-lt__axis">
              <span className="label">Case</span>
              <CaseChip kase={kase} />
            </span>
          </p>
          <Gate key={item.id} item={item} keys layout="stack" onDecided={onDecided} />
          <ItemFacts item={item} names={names} compact />
        </aside>
      </div>

      <div className="bd-sheet">
        <h2 className="bd-sheet__h">
          <span>Contact sheet</span>
          <span className="bd-hint">
            <kbd>←</kbd> <kbd>→</kbd> walk · <kbd>A</kbd> <kbd>S</kbd> <kbd>C</kbd> <kbd>B</kbd> decide ·{" "}
            <kbd>J</kbd> <kbd>K</kbd> next / previous pending · <kbd>Enter</kbd> to the gate · <kbd>Esc</kbd> back here
          </span>
        </h2>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: arrow keys move the roving focus between frame buttons */}
        <div className="bd-sheet__strip" onKeyDown={onStripKey}>
          {items.map((it, i) => (
            <button
              key={it.id}
              type="button"
              ref={(el) => {
                frames.current.set(it.id, el);
              }}
              className={`bd-frame bd-frame--${itemState(it)} ${it.id === currentId ? "is-cur" : ""}`}
              data-testid={`board-item-${it.id}`}
              aria-current={it.id === currentId ? "true" : undefined}
              aria-keyshortcuts="J K"
              tabIndex={it.id === currentId ? 0 : -1}
              onClick={() => go(it.id)}
            >
              <span className="bd-frame__img">
                <Shot item={it} fit="height" alt="" />
                <Grease state={itemState(it)} />
              </span>
              <span className="bd-frame__cap">
                <span className="mono bd-frame__no">{frameNo(i)}</span>
                <StateMark item={it} />
              </span>
              <span className="bd-frame__title">{it.title}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

/** The grease pencil on a contact sheet: a ring round an accepted frame, a cross over a rejected one. */
function Grease({ state }: { state: ReturnType<typeof itemState> }) {
  if (state === "pending") return null;
  return (
    <svg
      className={`bd-grease bd-grease--${state}`}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {state === "accepted" ? (
        <ellipse cx="50" cy="50" rx="44" ry="45" fill="none" strokeWidth="3.2" vectorEffect="non-scaling-stroke" />
      ) : (
        <path d="M12 10 88 90M88 12 10 88" fill="none" strokeWidth="3.2" vectorEffect="non-scaling-stroke" />
      )}
    </svg>
  );
}
