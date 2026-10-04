/**
 * Board pieces shared by all three variants: data hooks (GET /api/board, the decision mutation),
 * the shot frame (mixed 9:16 / 16:9 / probe sizes), the decision mark (shape + label, hue last),
 * the item detail body (style, use case, provenance, decision) and the gate (Accept, Reject style,
 * Reject case, Reject both, each with an optional note; A / S / C / B shortcuts).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type CSSProperties, type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { api, type BoardDecision, type BoardItem, type BoardResponse, qk, serverError } from "../api";
import { identVar } from "../components/idents";
import { useHeatmap } from "../data";
import { relTime } from "../logic";
import {
  type CaseRef,
  caseOf,
  DECISION_META,
  DECISIONS,
  decisionForKey,
  factRefs,
  groupFacts,
  type ItemState,
  itemState,
  neighbourAfterRemoval,
  nextPending,
  prevPending,
  provenance,
  ratioOf,
  shapeOf,
  sizeLabel,
  stateLabel,
  styleOf,
} from "./board";
import { keysSuppressed, plainPress } from "./keys";
import { acceptOutcome } from "./outcome";
import { showUndo } from "./undo";

// ------------------------------------------------------------------ data

export const useBoard = () => useQuery({ queryKey: qk.board, queryFn: () => api.board() });

/** Use case id -> registry name (from the heatmap), for existing cases. */
export function useCaseNames(): ReadonlyMap<string, string> {
  const hm = useHeatmap();
  return useMemo(() => new Map((hm.data?.usecases ?? []).map((u) => [u.id, u.name])), [hm.data]);
}

/** POST /api/board/:id/decision; the cached list is patched at once, then refetched (SSE also invalidates). */
export function useDecide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; decision: BoardDecision; note?: string }) => {
      const r = await api.decideBoard(v.id, v.decision, v.note);
      void qc.invalidateQueries({ queryKey: qk.generation }); // an accepted variant queues its video (or is data-blocked), siblings are archived
      // an accept says what it queued (or why data blocked it) and carries its job: the owner has left the view by now
      if (v.decision === "accept") {
        const o = acceptOutcome(r, r.item.title);
        showUndo(o.message, () => api.undoBoardDecision(r.item.id), { jobId: o.jobId, blocked: o.blocked });
      }
      return r.item;
    },
    onSuccess: (item, v) => {
      qc.setQueryData<BoardResponse>(qk.board, (prev) =>
        prev ? { ...prev, items: prev.items.map((i) => (i.id === item.id ? { ...i, ...item } : i)) } : prev,
      );
      void qc.invalidateQueries({ queryKey: qk.board });
      // a rejected proposal leaves the grid: offer to take it back (D.1)
      if (v.decision !== "accept") showUndo(`${DECISION_META[v.decision].done} · ${item.title}`, () => api.undoBoardDecision(item.id));
    },
  });
}

/** DELETE /api/board/:id/decision: the item goes back to pending. */
export function useUndoDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.undoBoardDecision(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.board });
      void qc.invalidateQueries({ queryKey: qk.styles });
    },
  });
}

// ------------------------------------------------------------------ marks

/** The decision as a drawn shape: ring (pending), disc + tick (accepted), square / triangle / both crossed. */
export function DecisionGlyph({
  state,
  decision,
  size = 14,
}: {
  state: ItemState;
  decision: BoardDecision | null;
  size?: number;
}) {
  let inner: ReactNode;
  if (state === "pending")
    inner = <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="2.4 2" />;
  else if (state === "accepted")
    inner = (
      <>
        <circle cx="8" cy="8" r="7" fill="currentColor" />
        <path
          d="M4.6 8.2l2.3 2.3 4.6-4.9"
          fill="none"
          stroke="var(--bd-glyph-ink, var(--color-bg))"
          strokeWidth="1.9"
        />
      </>
    );
  else if (decision === "reject_case")
    inner = (
      <>
        <path d="M8 1.6 14.6 14H1.4Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M6 8.2l4 4M10 8.2l-4 4" stroke="currentColor" strokeWidth="1.5" />
      </>
    );
  else if (decision === "reject_both")
    inner = (
      <>
        <rect x="1.5" y="1.5" width="13" height="13" fill="currentColor" />
        <path d="M4.8 4.8l6.4 6.4M11.2 4.8l-6.4 6.4" stroke="var(--bd-glyph-ink, var(--color-bg))" strokeWidth="1.9" />
      </>
    );
  else
    inner = (
      <>
        <rect x="1.75" y="1.75" width="12.5" height="12.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M4.8 4.8l6.4 6.4M11.2 4.8l-6.4 6.4" stroke="currentColor" strokeWidth="1.6" />
      </>
    );
  return (
    <svg className="bd-glyph" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      {inner}
    </svg>
  );
}

/** The state on a shot: shape + word ("Pending", "Accepted", "Rejected · style" ...). */
export function StateMark({ item, className = "" }: { item: BoardItem; className?: string }) {
  const state = itemState(item);
  return (
    <span className={`bd-state bd-state--${state} ${item.decision ? `bd-state--${item.decision}` : ""} ${className}`}>
      <DecisionGlyph state={state} decision={item.decision} />
      <span>{stateLabel(item)}</span>
    </span>
  );
}

/** A use case chip: an existing case in its ident colour, a proposed one marked as proposed. */
export function CaseChip({ kase }: { kase: CaseRef }) {
  return kase.kind === "existing" ? (
    <span className="bd-case" style={{ ["--ident" as string]: identVar(kase.id) } as CSSProperties}>
      <i aria-hidden="true" />
      {kase.name}
    </span>
  ) : (
    <span className="bd-case bd-case--proposed">
      <b>Proposed</b>
      {kase.name}
    </span>
  );
}

// ------------------------------------------------------------------ the shot

/**
 * One screenshot in a frame of its own aspect (clamped 9:16 .. 16:9). `fit="height"` sizes the
 * frame by the container height (light table, matrix cells); default sizes it by width.
 */
export function Shot({
  item,
  fit = "width",
  alt = "",
  eager = false,
}: {
  item: BoardItem;
  fit?: "width" | "height" | "box";
  alt?: string;
  eager?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const shape = shapeOf(item.width, item.height);
  const tiny = (item.width ?? 0) < 64 || (item.height ?? 0) < 64;
  return (
    <span
      className={`bd-shot bd-shot--${shape} bd-shot--fit-${fit} ${tiny ? "is-tiny" : ""}`}
      style={fit === "box" ? undefined : { aspectRatio: String(ratioOf(item.width, item.height)) }}
    >
      {broken ? (
        <span className="bd-shot__broken">
          Image missing
          <span className="mono">{item.image}</span>
        </span>
      ) : item.video_url ? (
        <ClipVideo item={item} controls={eager} alt={alt} onError={() => setBroken(true)} />
      ) : (
        <img
          src={item.image_url}
          alt={alt}
          width={item.width ?? undefined}
          height={item.height ?? undefined}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          draggable={false}
          onError={() => setBroken(true)}
        />
      )}
      {item.video_url && !broken ? <ClipBadge item={item} /> : null}
      {tiny && !broken ? <span className="bd-shot__tiny mono">{sizeLabel(item.width, item.height)} probe</span> : null}
    </span>
  );
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Clip seek-stability as measured at harvest (source.clip.seek_stable); undefined for stills/older items. */
export const clipStable = (i: BoardItem): boolean | undefined =>
  (i.source?.clip as { seek_stable?: boolean } | undefined)?.seek_stable;

/**
 * A board clip: poster first; plays muted on loop only while on screen (many clips on a wall), never
 * under reduced motion unless the owner presses play. `controls` in the detail view.
 */
function ClipVideo({ item, controls, alt, onError }: { item: BoardItem; controls: boolean; alt: string; onError: () => void }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v || reducedMotion()) return;
    if (controls) {
      void v.play().catch(() => {});
      return;
    }
    const io = new IntersectionObserver(([e]) => (e?.isIntersecting ? void v.play().catch(() => {}) : v.pause()), { threshold: 0.35 });
    io.observe(v);
    return () => io.disconnect();
  }, [controls]);
  return (
    <video
      ref={ref}
      src={item.video_url ?? undefined}
      poster={item.image_url}
      aria-label={alt || undefined}
      muted
      loop
      playsInline
      controls={controls}
      preload={controls ? "auto" : "none"}
      width={item.width ?? undefined}
      height={item.height ?? undefined}
      onError={onError}
    />
  );
}

type ClipInfo = {
  seek_stable?: boolean;
  full_duration_s?: number;
  excerpt?: { start_s: number; duration_s: number };
  timeline?: { unit: string; from: number; to: number };
  longevity?: { ok: boolean; problems: string[] };
};
export const clipInfo = (i: BoardItem): ClipInfo | undefined => i.source?.clip as ClipInfo | undefined;

/**
 * A time-evolution design (ADR 007): the Board plays one cut-out from the middle of a 30-90 s run.
 * The badge puts the cut in context (where in the run, over which data time) and surfaces the
 * harness's longevity and seek-stability findings.
 */
function ClipBadge({ item }: { item: BoardItem }) {
  const c = clipInfo(item);
  const stable = clipStable(item);
  const cut = c?.excerpt && c.full_duration_s
    ? `CUT ${c.excerpt.start_s.toFixed(0)}-${(c.excerpt.start_s + c.excerpt.duration_s).toFixed(0)} s OF ${c.full_duration_s.toFixed(0)} s`
    : `CLIP ${item.duration_s?.toFixed(1) ?? "?"} s`;
  return (
    <span className="bd-clip">
      <span className="bd-clip__len mono">{cut}</span>
      {c?.timeline ? <span className="bd-clip__len mono">{c.timeline.from}→{c.timeline.to} · {c.timeline.unit}</span> : null}
      {c?.longevity && !c.longevity.ok ? <span className="bd-clip__warn mono">LONGEVITY: {c.longevity.problems.join(" · ")}</span> : null}
      {stable === false ? <span className="bd-clip__warn mono">NOT SEEK-STABLE · won't port to video</span> : null}
    </span>
  );
}

export const shotAlt = (i: BoardItem): string =>
  `Design shot ${sizeLabel(i.width, i.height)}, ${shapeOf(i.width, i.height)}: ${i.title}`;

// ------------------------------------------------------------------ detail body

function Sec({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <section className="bd-sec" aria-labelledby={id}>
      <h3 className="bd-sec__h" id={id}>
        {title}
      </h3>
      {children}
    </section>
  );
}

/** Everything known about one item: summary, style, use case, provenance, decision. */
export function ItemFacts({
  item,
  names,
  compact = false,
}: {
  item: BoardItem;
  names: ReadonlyMap<string, string>;
  compact?: boolean;
}) {
  const uid = useId();
  const style = styleOf(item);
  const kase = caseOf(item, names);
  const facts = factRefs(item.source);
  const grouped = groupFacts(facts);
  const prov = provenance(item.source);
  return (
    <div className={`bd-facts ${compact ? "bd-facts--compact" : ""}`}>
      {item.summary ? (
        <p className="bd-facts__sum">{item.summary}</p>
      ) : (
        <p className="bd-facts__sum is-none">No summary.</p>
      )}

      <Sec title="Style" id={`${uid}-s`}>
        <p className="bd-kv">
          <b className="bd-style-name">{style.name}</b>
          {style.id ? <span className="mono bd-id">{style.id}</span> : null}
        </p>
        {style.notes ? <p className="bd-note-text">{style.notes}</p> : null}
      </Sec>

      <Sec title={kase.kind === "existing" ? "Use case · existing" : "Use case · proposed"} id={`${uid}-c`}>
        <p className="bd-kv">
          <CaseChip kase={kase} />
        </p>
        {kase.kind === "existing" ? (
          <p className="bd-note-text">
            <Link
              className="bd-link"
              to="/heatmap/$usecase/$sport"
              params={{ usecase: kase.id, sport: "F1" }}
              search={{}}
            >
              Open the heatmap cell · {kase.id} × F1
            </Link>
          </p>
        ) : (
          <>
            {kase.pitch ? <p className="bd-note-text">{kase.pitch}</p> : null}
            <p className="bd-kv">
              <span className="label">Requires</span>
              {kase.requires.length ? (
                kase.requires.map((k) => (
                  <span key={k} className="chip">
                    {k}
                  </span>
                ))
              ) : (
                <span className="bd-dim">no kinds named</span>
              )}
            </p>
            <p className="bd-dim">Not on the registry yet. Accepting it asks for a use case YAML, not a video.</p>
          </>
        )}
      </Sec>

      <Sec title="Provenance" id={`${uid}-p`}>
        <dl className="bd-dl">
          {prov.map((p) => (
            <div key={p.k}>
              <dt>{p.k}</dt>
              <dd className="mono">{p.v}</dd>
            </div>
          ))}
          <div>
            <dt>shot</dt>
            <dd className="mono">
              {sizeLabel(item.width, item.height)} · {item.image}
            </dd>
          </div>
          <div>
            <dt>posted</dt>
            <dd>
              <time dateTime={item.created_at}>{relTime(item.created_at)}</time>
            </dd>
          </div>
          <div>
            <dt>item</dt>
            <dd className="mono">{item.id}</dd>
          </div>
        </dl>
        {facts.length ? (
          <details className="bd-factlist">
            <summary>
              {facts.length} fact refs · {grouped.length} facts
            </summary>
            <ul>
              {grouped.map((g) => (
                <li key={g.key}>
                  <span className="mono">{g.key}</span>
                  {g.cols.length ? <span className="mono bd-cols">#{g.cols.join(" #")}</span> : null}
                </li>
              ))}
            </ul>
          </details>
        ) : (
          <p className="bd-dim">No fact refs on this item.</p>
        )}
      </Sec>
    </div>
  );
}

// ------------------------------------------------------------------ the gate


/**
 * A flag that is true for a moment after `flash()`: the "busy" feedback for a keystroke that was
 * dropped because a decision is still in flight (silence reads as a broken key).
 */
export function useFlash(ms = 1200): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const flash = useCallback(() => {
    clearTimeout(timer.current);
    setOn(true);
    timer.current = setTimeout(() => setOn(false), ms);
  }, [ms]);
  return [on, flash];
}

/**
 * J / K: next / previous pending shot, the same in every variant (triage without the mouse).
 * `current` is the shot the cursor is on (open lightbox, drawer, loupe or focused tile); `jump`
 * moves there. Ignored while typing, with a modifier, and (when `scope` is given) while focus is
 * on something outside the variant, such as the filters.
 */
export function useJumpKeys(
  order: readonly BoardItem[],
  current: string | null,
  jump: (id: string) => void,
  scope?: React.RefObject<HTMLElement | null>,
) {
  const live = useRef({ order, current, jump });
  live.current = { order, current, jump };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if ((k !== "j" && k !== "k") || e.ctrlKey || e.metaKey || e.altKey || keysSuppressed(e.target)) return;
      const t = e.target;
      if (scope?.current && t instanceof Node && t !== document.body && !scope.current.contains(t)) return;
      const { order: o, current: c, jump: go } = live.current;
      const id = k === "j" ? nextPending(o, c) : prevPending(o, c);
      if (!id) return;
      e.preventDefault();
      go(id);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [scope]);
}

/**
 * When the shot the cursor is on leaves `order` (a decision under the pending filter, a reject
 * anywhere), move to its neighbour instead of letting the view collapse (ADR 006). With no
 * neighbour left the cursor stays, so the lightbox can still show what was just decided.
 */
export function useAdvanceOnRemoval(order: readonly { id: string }[], id: string | null, go: (id: string) => void) {
  const last = useRef(order);
  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => {
    if (id && !order.some((i) => i.id === id)) {
      const n = neighbourAfterRemoval(last.current, id);
      if (n) goRef.current(n);
    } else last.current = order;
  }, [order, id]);
}

/**
 * The owner's gate for one item. A / S / C / B decide while `keys` is on and focus is not in a
 * text field. Re-deciding is allowed (the latest decision stands). `onDecided` runs after the
 * server stored it.
 */
export function Gate({
  item,
  keys,
  onDecided,
  layout = "bar",
  autoFocusNote = false,
}: {
  item: BoardItem;
  keys: boolean;
  onDecided?: (item: BoardItem, decision: BoardDecision) => void;
  layout?: "bar" | "stack";
  autoFocusNote?: boolean;
}) {
  const uid = useId();
  const decide = useDecide();
  const undo = useUndoDecision();
  const [note, setNote] = useState(item.note ?? "");
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const state = itemState(item);
  const [busy, flashBusy] = useFlash();
  const run = useRef<(d: BoardDecision) => void>(() => {});
  run.current = (d: BoardDecision) => {
    if (decide.isPending) {
      flashBusy();
      return;
    }
    decide.mutate({ id: item.id, decision: d, note }, { onSuccess: (saved) => onDecided?.({ ...item, ...saved }, d) });
  };

  useEffect(() => {
    if (!keys) return;
    const onKey = (e: KeyboardEvent) => {
      if (!plainPress(e) || keysSuppressed(e.target)) return;
      const d = decisionForKey(e.key);
      if (!d) return;
      e.preventDefault();
      run.current(d);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [keys]);

  useEffect(() => {
    if (autoFocusNote) noteRef.current?.focus({ preventScroll: true });
  }, [autoFocusNote]);

  return (
    <section className={`bd-gate bd-gate--${layout}`} aria-labelledby={`${uid}-h`}>
      <div className="bd-gate__head">
        <h3 className="bd-sec__h" id={`${uid}-h`}>
          Your gate
        </h3>
        <span aria-live="polite" className="bd-gate__now">
          {busy ? (
            <span className="bd-busy" data-testid="gate-busy">
              Still recording the last one, press again
            </span>
          ) : decide.isPending ? (
            <span className="bd-dim">Recording…</span>
          ) : state === "pending" ? (
            <span className="bd-dim">Not decided yet</span>
          ) : (
            <>
              <StateMark item={item} />
              {item.decided_at ? <time dateTime={item.decided_at}>{relTime(item.decided_at)}</time> : null}
              <button
                type="button"
                className="bd-linkbtn"
                data-testid="undo-decision"
                aria-disabled={undo.isPending || undefined}
                onClick={() => {
                  if (!undo.isPending) undo.mutate(item.id);
                }}
              >
                Undo
              </button>
            </>
          )}
        </span>
      </div>
      {item.note && state !== "pending" ? <p className="bd-gate__said">“{item.note}”</p> : null}
      <label className="bd-gate__note">
        <span className="label">Note for the next loop (optional)</span>
        <textarea
          ref={noteRef}
          data-testid="decision-note"
          rows={layout === "bar" ? 1 : 2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What to keep, what to drop (quoted in the next brief)"
        />
      </label>
      <fieldset className="bd-gate__btns">
        <legend className="sr-only">Decision</legend>
        {DECISIONS.map((d) => (
          <button
            key={d}
            type="button"
            className={`btn bd-dec bd-dec--${d} ${d === "accept" ? "btn--primary" : ""} ${item.decision === d ? "is-current" : ""}`}
            data-testid={d.replace("_", "-")}
            aria-pressed={item.decision === d}
            aria-keyshortcuts={DECISION_META[d].key}
            title={DECISION_META[d].axis}
            aria-disabled={decide.isPending || undefined}
            onClick={() => run.current(d)}
          >
            <DecisionGlyph state={d === "accept" ? "accepted" : "rejected"} decision={d} size={15} />
            <span>{DECISION_META[d].label}</span>
            <kbd>{DECISION_META[d].key}</kbd>
          </button>
        ))}
      </fieldset>
      {decide.isError ? (
        <p className="bd-gate__err" role="alert">
          Not recorded: <span className="mono">{serverError(decide.error)}</span>
        </p>
      ) : null}
      {undo.isError ? (
        <p className="bd-gate__err" role="alert">
          Not undone: <span className="mono">{serverError(undo.error)}</span>
        </p>
      ) : null}
    </section>
  );
}

// ------------------------------------------------------------------ small layout helpers

/** Current width of an element (ResizeObserver); 0 until measured. */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((es) => {
      for (const e of es) setW(Math.floor(e.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** On-screen boxes of the given elements, for spatialMove. */
export const boxesOf = (els: (HTMLElement | null)[]) =>
  els.map((el) => {
    const r = el?.getBoundingClientRect();
    return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : { x: 0, y: 0, w: 0, h: 0 };
  });
