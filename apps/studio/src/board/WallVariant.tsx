/**
 * Variant 1 · Wall. Every shot at once on a justified wall: each row fills the width, each tile
 * keeps its own aspect, so 9:16 and 16:9 shots sit side by side at the same height, big. The
 * state rides on every tile (shape + word). Click or Enter opens a lightbox (a modal dialog):
 * the shot as large as the screen allows, the facts beside it and a sticky decision bar below.
 * Arrows walk the wall spatially; in the lightbox Left/Right step through shots, A / S / C / B
 * decide, Esc closes back to the tile. Best at: seeing the whole loop and comparing languages.
 */
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BoardItem } from "../api";
import { Arrow } from "../components/glyphs";
import type { VariantProps } from "./BoardPage";
import { caseOf, groupItems, isMoveKey, itemState, justify, nextPending, ratioOf, spatialMove, styleOf } from "./board";
import { boxesOf, CaseChip, Gate, ItemFacts, Shot, StateMark, shotAlt, useWidth } from "./shared";

type GroupBy = "none" | "style" | "case";
const CAPTION = 76; // px under each image: title, style, case

function targetHeight(w: number): number {
  if (w >= 1600) return 540;
  if (w >= 1100) return 440;
  if (w >= 700) return 360;
  return 420;
}

export function WallVariant({ items, all, names }: VariantProps) {
  const [by, setBy] = useState<GroupBy>("none");
  const [cur, setCur] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [ref, width] = useWidth<HTMLDivElement>();
  const tiles = useRef(new Map<string, HTMLButtonElement | null>());
  const groups = useMemo(() => groupItems(items, by, names), [items, by, names]);
  const order = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const focusId = cur && order.some((i) => i.id === cur) ? cur : (order[0]?.id ?? null);
  const gap = width < 700 ? 10 : 14;
  const target = targetHeight(width);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!isMoveKey(e.key) || !focusId) return;
    const from = order.findIndex((i) => i.id === focusId);
    const to = spatialMove(boxesOf(order.map((i) => tiles.current.get(i.id) ?? null)), from, e.key);
    e.preventDefault();
    const next = to === null ? undefined : order[to];
    if (!next) return;
    setCur(next.id);
    tiles.current.get(next.id)?.focus();
  };

  const close = useCallback(() => {
    const id = open;
    setOpen(null);
    if (id) {
      setCur(id);
      // the dialog is already closed (the wall is no longer inert): focus now, and again after the render
      tiles.current.get(id)?.focus({ preventScroll: true });
      window.requestAnimationFrame(() => tiles.current.get(id)?.focus({ preventScroll: true }));
    }
  }, [open]);

  const openItem = order.find((i) => i.id === open) ?? all.find((i) => i.id === open) ?? null;

  return (
    <section className="bd-wall" aria-label="Wall of shots">
      <div className="bd-wall__bar">
        <span className="label">Group</span>
        <fieldset className="seg seg--sm">
          <legend className="sr-only">Group the wall</legend>
          {(["none", "style", "case"] as const).map((g) => (
            <button key={g} type="button" aria-pressed={by === g} onClick={() => setBy(g)}>
              {g === "none" ? "No groups" : g === "style" ? "By style" : "By case"}
            </button>
          ))}
        </fieldset>
        <span className="bd-hint">
          <kbd>←</kbd>
          <kbd>→</kbd>
          <kbd>↑</kbd>
          <kbd>↓</kbd> move · <kbd>Enter</kbd> open · in the shot <kbd>A</kbd> <kbd>S</kbd> <kbd>C</kbd> <kbd>B</kbd>{" "}
          decide · <kbd>Esc</kbd> close
        </span>
      </div>

      {/* biome-ignore lint/a11y/noStaticElementInteractions: arrow keys move the roving focus between tile buttons */}
      <div className="bd-wall__body" ref={ref} onKeyDown={onKey}>
        {width
          ? groups.map((g) => {
              const rows = justify(
                g.items.map((i) => ratioOf(i.width, i.height)),
                width,
                target,
                gap,
              );
              return (
                <div key={g.key} className="bd-wall__group">
                  {by !== "none" ? (
                    <h2 className="bd-wall__gh">
                      {g.proposed ? <b className="bd-tag">Proposed</b> : null}
                      <span>{g.label}</span>
                      <span className="num bd-dim">
                        {g.items.length} shot{g.items.length === 1 ? "" : "s"} ·{" "}
                        {g.items.filter((i) => itemState(i) === "pending").length} pending
                      </span>
                    </h2>
                  ) : null}
                  {rows.map((row) => (
                    <div
                      key={row.tiles.map((t) => g.items[t.index]?.id).join("-")}
                      className="bd-wall__row"
                      style={{ gap }}
                    >
                      {row.tiles.map((t) => {
                        const it = g.items[t.index];
                        if (!it) return null;
                        return (
                          <WallTile
                            key={it.id}
                            item={it}
                            w={t.w}
                            h={row.h}
                            names={names}
                            focusable={it.id === focusId}
                            register={(el) => tiles.current.set(it.id, el)}
                            onOpen={() => {
                              setCur(it.id);
                              setOpen(it.id);
                            }}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
              );
            })
          : null}
      </div>

      {openItem ? (
        <Lightbox
          item={openItem}
          order={order}
          names={names}
          onClose={close}
          onGo={(id) => {
            setOpen(id);
            setCur(id);
          }}
        />
      ) : null}
    </section>
  );
}

function WallTile({
  item,
  w,
  h,
  names,
  focusable,
  register,
  onOpen,
}: {
  item: BoardItem;
  w: number;
  h: number;
  names: ReadonlyMap<string, string>;
  focusable: boolean;
  register: (el: HTMLButtonElement | null) => void;
  onOpen: () => void;
}) {
  const state = itemState(item);
  const style = styleOf(item);
  const kase = caseOf(item, names);
  return (
    <button
      type="button"
      ref={register}
      className={`bd-tile bd-tile--${state}`}
      data-testid={`board-item-${item.id}`}
      style={{ width: w }}
      tabIndex={focusable ? 0 : -1}
      aria-haspopup="dialog"
      onClick={onOpen}
    >
      <span className="bd-tile__img" style={{ height: h }}>
        <Shot item={item} fit="box" alt={shotAlt(item)} />
        <StateMark item={item} className="bd-tile__state" />
      </span>
      <span className="bd-tile__cap" style={{ height: CAPTION }}>
        <span className="bd-tile__title">{item.title}</span>
        <span className="bd-tile__meta">
          <span className="bd-tile__style">{style.name}</span>
          <CaseChip kase={kase} />
        </span>
      </span>
    </button>
  );
}

// ------------------------------------------------------------------ lightbox

function Lightbox({
  item,
  order,
  names,
  onClose,
  onGo,
}: {
  item: BoardItem;
  order: BoardItem[];
  names: ReadonlyMap<string, string>;
  onClose: () => void;
  onGo: (id: string) => void;
}) {
  const dlg = useRef<HTMLDialogElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const nextBtn = useRef<HTMLButtonElement>(null);
  const [justDecided, setJustDecided] = useState<string | null>(null);
  const idx = order.findIndex((i) => i.id === item.id);
  const prev = idx > 0 ? order[idx - 1] : undefined;
  const next = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : undefined;
  const pendingNext = nextPending(order, item.id);
  /** Close the native dialog first (the page behind stops being inert), then leave. */
  const shut = () => {
    if (dlg.current?.open) dlg.current.close();
    onClose();
  };

  useEffect(() => {
    const d = dlg.current;
    if (d && !d.open) {
      d.showModal();
      closeBtn.current?.focus({ preventScroll: true });
    }
    document.documentElement.classList.add("bd-modal-open");
    return () => document.documentElement.classList.remove("bd-modal-open");
  }, []);

  // a new shot: fresh decision state, focus stays inside the dialog
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on every shot change
  useEffect(() => {
    setJustDecided(null);
    dlg.current?.querySelector(".bd-lb__panel")?.scrollTo({ top: 0 });
  }, [item.id]);

  useEffect(() => {
    if (justDecided === item.id) nextBtn.current?.focus({ preventScroll: true });
  }, [justDecided, item.id]);

  const onKey = (e: KeyboardEvent<HTMLDialogElement>) => {
    const t = e.target as HTMLElement;
    if (t.closest("input, textarea, select")) return;
    if (e.key === "ArrowLeft" && prev) {
      e.preventDefault();
      onGo(prev.id);
    } else if (e.key === "ArrowRight" && next) {
      e.preventDefault();
      onGo(next.id);
    }
  };

  return (
    <dialog
      ref={dlg}
      className="bd-lb"
      aria-labelledby="bd-lb-title"
      onCancel={(e) => {
        e.preventDefault();
        shut();
      }}
      onKeyDown={onKey}
      onClick={(e) => {
        if (e.target === dlg.current) shut();
      }}
    >
      <div className="bd-lb__top">
        <span className="label num">
          Shot {idx + 1} of {order.length}
        </span>
        <div className="bd-lb__nav">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={!prev}
            onClick={() => prev && onGo(prev.id)}
          >
            <Arrow dir="left" /> <span className="bd-lb__word">Previous</span> <kbd>←</kbd>
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={!next}
            onClick={() => next && onGo(next.id)}
          >
            <span className="bd-lb__word">Next</span> <kbd>→</kbd> <Arrow />
          </button>
        </div>
        <button ref={closeBtn} type="button" className="btn btn--sm bd-lb__close" onClick={shut}>
          Close <kbd>Esc</kbd>
        </button>
      </div>

      <div className="bd-lb__main">
        <figure className="bd-lb__stage">
          <Shot item={item} fit="box" alt={shotAlt(item)} eager />
        </figure>
        <div className="bd-lb__panel">
          <p className="eyebrow">
            <i />
            Design output · not a result
          </p>
          <h2 className="bd-lb__title" id="bd-lb-title">
            {item.title}
          </h2>
          <StateMark item={item} className="bd-lb__state" />
          <ItemFacts item={item} names={names} />
        </div>
      </div>

      <div className="bd-lb__bar">
        <Gate key={item.id} item={item} keys layout="bar" onDecided={(it) => setJustDecided(it.id)} />
        <div className="bd-lb__after" aria-live="polite">
          {itemState(item) !== "pending" ? (
            pendingNext ? (
              <button
                ref={nextBtn}
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => onGo(pendingNext)}
              >
                Next pending <Arrow />
              </button>
            ) : (
              <span className="bd-dim">Every shot in view is decided.</span>
            )
          ) : null}
        </div>
      </div>
    </dialog>
  );
}
