/**
 * The rejected lane (SPEC D.1 keeps rejections out of the default views; this is the deliberate
 * way back): every rejected shot as a read-only card with its decision and note, an Undo (back to
 * pending, DELETE /decision) and the other decisions to re-decide. One lane for all three
 * prototype variants, so the owner's pick does not change how a mistaken reject is recovered.
 */
import { useEffect, useRef } from "react";
import { serverError } from "../api";
import type { BoardItem } from "../api";
import type { VariantProps } from "./BoardPage";
import { caseOf, DECISION_META, DECISIONS, neighbourAfterRemoval, ratioOf, styleOf } from "./board";
import { CaseChip, DecisionGlyph, Shot, StateMark, shotAlt, useDecide, useFlash, useUndoDecision } from "./shared";

/** shot height on a card (px), like the matrix cell */
const SHOT_H = 200;

export function RejectedLane({ items, names }: Pick<VariantProps, "items" | "names">) {
  const decide = useDecide();
  const undo = useUndoDecision();
  const [busy, flashBusy] = useFlash();
  const cards = useRef(new Map<string, HTMLElement | null>());
  /** the card to focus after the acted-on one left the lane (triage keeps its place) */
  const refocus = useRef<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs after every list change
  useEffect(() => {
    const id = refocus.current;
    if (!id) return;
    const el = cards.current.get(id)?.querySelector<HTMLElement>("button");
    if (el) {
      refocus.current = null;
      el.focus({ preventScroll: true });
    }
  }, [items]);

  const act = (it: BoardItem, run: (opts: { onSuccess: () => void }) => void) => {
    if (decide.isPending || undo.isPending) {
      flashBusy();
      return;
    }
    const next = neighbourAfterRemoval(items, it.id);
    run({
      onSuccess: () => {
        refocus.current = next;
      },
    });
  };

  return (
    <section className="bd-rl" aria-label="Rejected shots" data-testid="rejected-lane">
      <p className="bd-rl__intro">
        <span>
          Rejected shots stay out of every other view. <b>Undo</b> sends one back to pending; the other buttons change the
          verdict.
        </span>
        {busy ? (
          <b className="bd-busy" role="status">
            Still recording the last one, try again
          </b>
        ) : null}
      </p>
      <ul className="bd-rl__list">
        {items.map((it) => {
          const style = styleOf(it);
          const kase = caseOf(it, names);
          const ratio = ratioOf(it.width, it.height);
          return (
            <li
              key={it.id}
              className="bd-rl__card"
              data-testid={`rejected-item-${it.id}`}
              ref={(el) => {
                cards.current.set(it.id, el);
              }}
            >
              <span
                className="bd-rl__img"
                style={{ aspectRatio: String(ratio), width: `${Math.round(SHOT_H * ratio)}px` }}
              >
                <Shot item={it} fit="box" alt={shotAlt(it)} />
              </span>
              <div className="bd-rl__body">
                <h3 className="bd-rl__title">{it.title}</h3>
                <StateMark item={it} />
                <p className="bd-rl__meta">
                  <span>{style.name}</span>
                  <CaseChip kase={kase} />
                </p>
                {it.note ? <p className="bd-gate__said">“{it.note}”</p> : <p className="bd-dim">No note.</p>}
                <div className="bd-rl__btns">
                  <button
                    type="button"
                    className="btn btn--sm btn--primary"
                    data-testid={`rejected-undo-${it.id}`}
                    aria-disabled={undo.isPending || undefined}
                    onClick={() => act(it, (o) => undo.mutate(it.id, o))}
                  >
                    Undo · back to pending
                  </button>
                  {DECISIONS.filter((d) => d !== it.decision).map((d) => (
                    <button
                      key={d}
                      type="button"
                      className="btn btn--sm btn--ghost bd-dec"
                      data-testid={`rejected-${d.replace("_", "-")}-${it.id}`}
                      title={DECISION_META[d].axis}
                      aria-disabled={decide.isPending || undefined}
                      onClick={() =>
                        act(it, (o) => decide.mutate({ id: it.id, decision: d, note: it.note ?? undefined }, o))
                      }
                    >
                      <DecisionGlyph state={d === "accept" ? "accepted" : "rejected"} decision={d} size={14} />
                      <span>{DECISION_META[d].label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {undo.isError ? (
        <p className="bd-gate__err" role="alert">
          Not undone: <span className="mono">{serverError(undo.error)}</span>
        </p>
      ) : null}
      {decide.isError ? (
        <p className="bd-gate__err" role="alert">
          Not recorded: <span className="mono">{serverError(decide.error)}</span>
        </p>
      ) : null}
    </section>
  );
}
