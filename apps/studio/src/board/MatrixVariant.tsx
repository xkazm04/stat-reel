/**
 * Variant 3 · Matrix. The ledger made visible: rows are styles, columns are use cases (existing
 * first, then proposed), each cell holds the shots of that pairing. Every axis carries its tally
 * (accepted / rejected on this axis / spared / pending) and its verdict, so feedback aimed at one
 * axis shows as a pattern: a rejected style hatches its whole row, a rejected case its column,
 * and an empty cell is an untried pairing (the next loop's opportunity). Click or Enter opens the
 * detail in a side drawer next to the matrix (A / S / C / B decide, Esc closes back to the shot).
 * Best at: training the style, seeing which axis is failing and what is still untried.
 */
import { type CSSProperties, type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BoardItem } from "../api";
import { identVar } from "../components/idents";
import type { VariantProps } from "./BoardPage";
import { type AxisTally, axisVerdict, isMoveKey, itemState, ledger, ratioOf, spatialMove } from "./board";
import { boxesOf, Gate, ItemFacts, Shot, StateMark, shotAlt } from "./shared";

/** shot height in a cell (px); a narrower column scales the shot down, keeping its aspect */
const SHOT_H = 210;

const VERDICT_WORD = {
  untested: "untested",
  open: "awaiting you",
  liked: "holding",
  rejected: "rejected",
  mixed: "mixed",
} as const;

function Tally({ t, axis }: { t: AxisTally; axis: "style" | "case" }) {
  const v = axisVerdict(t);
  return (
    <span className="bd-tally">
      <span className={`bd-verdict bd-verdict--${v}`}>{VERDICT_WORD[v]}</span>
      <span className="num">
        {t.accepted} accepted · {t.rejected} {axis} rejected
        {t.spared ? ` · ${t.spared} spared` : ""} · {t.pending} pending
      </span>
    </span>
  );
}

export function MatrixVariant({ items, scoped, names }: VariantProps) {
  // tallies keep the rejections as feedback on an axis; only visible shots are drawn
  const L = useMemo(() => {
    const shown = new Set(items.map((i) => i.id));
    return ledger(scoped, names, (i) => shown.has(i.id));
  }, [items, scoped, names]);
  const [open, setOpen] = useState<string | null>(null);
  const [cur, setCur] = useState<string | null>(null);
  const shots = useRef(new Map<string, HTMLButtonElement | null>());
  // row-major order, the same as the DOM
  const order = useMemo(() => L.styles.flatMap((s) => L.cases.flatMap((c) => L.cell(s.key, c.key))), [L]);
  const focusId = cur && order.some((i) => i.id === cur) ? cur : (order[0]?.id ?? null);
  const openItem = order.find((i) => i.id === open) ?? null;

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!isMoveKey(e.key) || !focusId) return;
    if (!(e.target as HTMLElement).closest(".bd-mx__shot")) return;
    const from = order.findIndex((i) => i.id === focusId);
    const to = spatialMove(boxesOf(order.map((i) => shots.current.get(i.id) ?? null)), from, e.key);
    e.preventDefault();
    const next = to === null ? undefined : order[to];
    if (!next) return;
    setCur(next.id);
    shots.current.get(next.id)?.focus();
    shots.current.get(next.id)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  const close = useCallback(() => {
    const id = open;
    setOpen(null);
    if (id) window.requestAnimationFrame(() => shots.current.get(id)?.focus());
  }, [open]);

  const cols = `minmax(200px, 240px) repeat(${L.cases.length}, minmax(220px, 1fr))`;

  return (
    <section className={`bd-mx ${openItem ? "has-drawer" : ""}`} aria-label="Style by case matrix">
      <p className="bd-mx__legend">
        <span>
          <b>Rows</b> styles · <b>columns</b> use cases. A hatched row or column is an axis you rejected; an empty cell
          is a pairing no loop has tried yet.
        </span>
        <span className="bd-hint">
          <kbd>←</kbd> <kbd>→</kbd> <kbd>↑</kbd> <kbd>↓</kbd> move · <kbd>Enter</kbd> open · <kbd>A</kbd> <kbd>S</kbd>{" "}
          <kbd>C</kbd> <kbd>B</kbd> decide · <kbd>Esc</kbd> close
        </span>
      </p>
      <div className="bd-mx__wrap">
        {/* biome-ignore lint/a11y/noStaticElementInteractions: arrow keys move the roving focus between shot buttons */}
        <div className="bd-mx__scroll" onKeyDown={onKey}>
          <div className="bd-mx__grid" style={{ gridTemplateColumns: cols }}>
            <div className="bd-mx__corner">
              <span className="label">Style ↓ · Case →</span>
              <span className="num bd-dim">
                {L.styles.length} × {L.cases.length} · {items.length} shots
              </span>
            </div>
            {L.cases.map((c) => (
              <div
                key={c.key}
                className={`bd-mx__ch bd-mx__ax--${axisVerdict(c)} ${c.proposed ? "is-proposed" : ""}`}
                style={c.sub ? ({ ["--ident" as string]: identVar(c.sub) } as CSSProperties) : undefined}
              >
                <span className="bd-mx__kind">{c.proposed ? <b className="bd-tag">Proposed</b> : "Existing"}</span>
                <b className="bd-mx__name">{c.label}</b>
                {c.sub ? <span className="mono bd-id">{c.sub}</span> : null}
                <Tally t={c} axis="case" />
              </div>
            ))}
            {L.styles.map((s) => (
              <Row
                key={s.key}
                s={s}
                cases={L.cases}
                cell={L.cell}
                focusId={focusId}
                openId={open}
                register={(id, el) => shots.current.set(id, el)}
                onOpen={(id) => {
                  setCur(id);
                  setOpen(id);
                }}
              />
            ))}
          </div>
        </div>
        {openItem ? <Drawer key={openItem.id} item={openItem} names={names} onClose={close} /> : null}
      </div>
    </section>
  );
}

function Row({
  s,
  cases,
  cell,
  focusId,
  openId,
  register,
  onOpen,
}: {
  s: AxisTally;
  cases: AxisTally[];
  cell: (style: string, kase: string) => BoardItem[];
  focusId: string | null;
  openId: string | null;
  register: (id: string, el: HTMLButtonElement | null) => void;
  onOpen: (id: string) => void;
}) {
  const sv = axisVerdict(s);
  return (
    <>
      <div className={`bd-mx__rh bd-mx__ax--${sv}`}>
        <b className="bd-mx__name">{s.label}</b>
        {s.sub ? <span className="mono bd-id">{s.sub}</span> : null}
        <Tally t={s} axis="style" />
      </div>
      {cases.map((c) => {
        const here = cell(s.key, c.key);
        const cv = axisVerdict(c);
        return (
          <div
            key={c.key}
            className={`bd-mx__cell ${here.length ? "" : "is-empty"} ${sv === "rejected" ? "row-rejected" : ""} ${cv === "rejected" ? "col-rejected" : ""}`}
          >
            {here.length ? (
              here.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  ref={(el) => register(it.id, el)}
                  className={`bd-mx__shot bd-mx__shot--${itemState(it)} ${openId === it.id ? "is-open" : ""}`}
                  data-testid={`board-item-${it.id}`}
                  tabIndex={it.id === focusId ? 0 : -1}
                  aria-expanded={openId === it.id}
                  onClick={() => onOpen(it.id)}
                >
                  <span
                    className="bd-mx__img"
                    style={{
                      aspectRatio: String(ratioOf(it.width, it.height)),
                      width: `${Math.round(SHOT_H * ratioOf(it.width, it.height))}px`,
                    }}
                  >
                    <Shot item={it} fit="box" alt={shotAlt(it)} />
                  </span>
                  <span className="bd-mx__cap">
                    <StateMark item={it} />
                    <span className="bd-mx__title">{it.title}</span>
                  </span>
                </button>
              ))
            ) : (
              <span className="bd-mx__none">untried</span>
            )}
          </div>
        );
      })}
    </>
  );
}

function Drawer({
  item,
  names,
  onClose,
}: {
  item: BoardItem;
  names: ReadonlyMap<string, string>;
  onClose: () => void;
}) {
  const closeBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeBtn.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("textarea, input, select")) {
        t.blur();
        return;
      }
      e.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <aside className="bd-mx__drawer" aria-labelledby="bd-mx-title">
      <div className="bd-mx__dtop">
        <p className="eyebrow">
          <i />
          Design output · not a result
        </p>
        <button ref={closeBtn} type="button" className="btn btn--sm" onClick={onClose}>
          Close <kbd>Esc</kbd>
        </button>
      </div>
      <div className="bd-mx__dshot">
        <Shot item={item} fit="box" alt={shotAlt(item)} eager />
      </div>
      <h2 className="bd-mx__dtitle" id="bd-mx-title">
        {item.title}
      </h2>
      <StateMark item={item} />
      <Gate item={item} keys layout="stack" />
      <ItemFacts item={item} names={names} compact />
    </aside>
  );
}
