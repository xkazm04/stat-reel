/**
 * The script, as a modal (native <dialog>: focus trap, Esc, backdrop). Every scene of the props in
 * order: kind, id, on-screen text, the narration as the viewer reads it (script display tokens),
 * its range on the timeline (measured, or the draft split) and captions CPS where computable.
 * Opened from the stage bar's Script key or a scene block on the timeline (at that scene).
 */
import type { EraAdjustedProps } from "@statreel/schemas";
import { sceneDisplayText } from "@statreel/schemas";
import { useEffect, useRef } from "react";
import type { ProjectDetail } from "../api";
import { NotEqual } from "../components/glyphs";
import { cps, peakCueCps, type SceneSpan, spanLabel } from "../studio-logic";

export function OnScreen({ text }: { text: string }) {
  const parts = text.split("≠");
  return (
    <>
      {parts.map((p, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static split
        <span key={i}>
          {i ? <NotEqual /> : null}
          {p}
        </span>
      ))}
    </>
  );
}

export function ScriptModal({
  open,
  at,
  onClose,
  detail,
  props,
  spans,
  onSeek,
}: {
  open: boolean;
  /** scene id to open at (highlighted, scrolled into view) */
  at: string | null;
  onClose: () => void;
  detail: ProjectDetail;
  props: EraAdjustedProps | null;
  spans: SceneSpan[];
  onSeek: (sceneId: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement as HTMLElement | null;
      d.showModal();
      const target = at ? d.querySelector<HTMLElement>(`[data-scene="${CSS.escape(at)}"]`) : null;
      window.requestAnimationFrame(() => {
        target?.scrollIntoView({ block: "center" });
        (target?.querySelector<HTMLElement>("button") ?? d.querySelector<HTMLElement>(".script__close"))?.focus();
      });
    } else if (!open && d.open) {
      d.close();
    }
  }, [open, at]);

  const script = detail.script?.script ?? null;
  const narration = new Map((script?.scenes ?? []).map((s) => [s.scene_id, sceneDisplayText(s)]));
  const byId = new Map(spans.map((s) => [s.id, s]));
  const measured = !!props?.timing;
  const cues = props?.timing?.cues ?? [];

  return (
    <dialog
      ref={ref}
      className="script"
      aria-labelledby="script-title"
      onClose={() => {
        onClose();
        opener.current?.focus?.();
      }}
      onClick={(e) => {
        // a click on the backdrop (the dialog box itself, outside its content) closes
        if (e.target === e.currentTarget) ref.current?.close();
      }}
    >
      <div className="script__box">
        <header className="script__head">
          <div>
            <p className="label">
              Script · {detail.project.id}
              {script ? ` · v${detail.script?.version}` : " · no script yet"} ·{" "}
              {measured ? "measured voice timing" : "draft timing, even split"}
            </p>
            <h2 id="script-title" className="script__title">
              {props?.title ?? detail.project.title}
            </h2>
          </div>
          <button type="button" className="btn btn--sm script__close" onClick={() => ref.current?.close()}>
            Close <kbd>Esc</kbd>
          </button>
        </header>
        {props ? (
          <ol className="script__list">
            {props.scenes.map((s, i) => {
              const sp = byId.get(s.id);
              const vo = narration.get(s.id);
              const rate = sp && vo ? cps(vo, sp.start, sp.end) : null;
              const cap = sp && measured ? peakCueCps(cues, sp.start, sp.end) : null;
              return (
                <li key={s.id} className={`script__scene${at === s.id ? " is-at" : ""}`} data-scene={s.id}>
                  <div className="script__tc">
                    <span className="script__n num">{String(i + 1).padStart(2, "0")}</span>
                    <b>{s.kind}</b>
                    <span className="mono">{s.id}</span>
                    {sp ? (
                      <span className="mono script__range">
                        {spanLabel(sp.start, sp.end)}
                        {sp.measured ? "" : " · draft"}
                      </span>
                    ) : (
                      <span className="label">no time yet</span>
                    )}
                  </div>
                  <div className="script__body">
                    <p className="script__on">
                      <OnScreen text={s.on_screen} />
                    </p>
                    <p className="script__vo">{vo ?? "No narration for this scene yet (the script is written by the co-pilot)."}</p>
                    <p className="script__meta mono">
                      {vo ? `${vo.length} chars` : "—"}
                      {rate !== null ? ` · ${rate.toFixed(1)} cps over the scene${sp?.measured ? "" : " (draft)"}` : ""}
                      {cap !== null ? ` · captions peak ${cap.toFixed(1)} cps` : ""}
                      {s.focus.length ? ` · focus ${s.focus.join(", ")}` : ""}
                    </p>
                    <button
                      type="button"
                      className="btn btn--sm btn--ghost"
                      disabled={!sp}
                      onClick={() => {
                        onSeek(s.id);
                        ref.current?.close();
                      }}
                    >
                      Seek to this scene
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="empty">
            <b>No props yet</b>
            Draft with Claude: the co-pilot stores props (scenes with on-screen text) and writes the narration.
          </div>
        )}
        <p className="script__foot">
          Figures in the narration cite facts (fact keys) and are checked when the script is stored. Target reading speed
          15–17 cps, hard max 20.
        </p>
      </div>
    </dialog>
  );
}
