/**
 * Board · Use cases (ADR 008): the stories, judged apart from any art style. Two layers:
 *   1. the inbox as a list of titles only (domain, span, kind), arrows to move, Enter to open;
 *   2. a detail dialog per idea with the triage keys of the design board: A accept, N not
 *      interesting, S too short, I no insight, D no data, U duplicate; Left/Right step, Esc closes,
 *      a decision jumps to the next undecided idea.
 * Below the inbox, every case the Board knows - registry formats, cases accepted through designs,
 * decided ideas - grouped by verdict.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { api, CASE_DECISIONS, type CaseDecision, type CaseIdea, type CasesResponse, qk, serverError } from "../api";
import { Empty, Failure, Loading } from "../components/ui";
import { useHeatmap } from "../data";
import {
  CASE_DECISION_META,
  type CaseRow,
  caseDecisionForKey,
  caseRows,
  DATA_STATUS_LABEL,
  DOMAIN_LABEL,
  inbox,
  KIND_LABEL,
  nextUndecided,
} from "./library";
import { useBoard } from "./shared";

const ORIGIN_WORD: Record<CaseRow["origin"], string> = { registry: "Registry", design: "From designs", idea: "Case loop" };

function useCases() {
  return useQuery({ queryKey: qk.cases, queryFn: () => api.cases() });
}

function useDecideCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; decision: CaseDecision; note?: string }) => api.decideCase(v.id, v.decision, v.note),
    onSuccess: (idea) => {
      qc.setQueryData<CasesResponse>(qk.cases, (prev) =>
        prev ? { ...prev, ideas: prev.ideas.map((i) => (i.id === idea.id ? idea : i)) } : prev,
      );
      void qc.invalidateQueries({ queryKey: qk.cases });
    },
  });
}

/** "Whoever leads" -> "whoever leads" mid-sentence; acronyms ("US", "GDP") stay as they are. */
const lowerFirst = (s: string): string => {
  const x = s.trim().replace(/[.;]+$/, "");
  return /^([A-Z][a-z]|A )/.test(x) ? x[0]!.toLowerCase() + x.slice(1) : x;
};

export function CasesView() {
  const cases = useCases();
  const board = useBoard();
  const hm = useHeatmap();
  const [domain, setDomain] = useState<string>("all");
  const [kind, setKind] = useState<string>("all");
  /** the open dialog: an idea and the order it steps through (frozen while open, so a decision does not reshuffle it) */
  const [open, setOpen] = useState<{ id: string; order: string[] } | null>(null);
  const ideas = cases.data?.ideas ?? [];
  const byId = useMemo(() => new Map(ideas.map((i) => [i.id, i])), [ideas]);
  const rows = useMemo(() => caseRows(hm.data?.usecases ?? [], board.data?.items ?? [], ideas), [hm.data, board.data, ideas]);
  const pending = useMemo(
    () => inbox(ideas).filter((i) => (domain === "all" || i.domain === domain) && (kind === "all" || i.kind === kind)),
    [ideas, domain, kind],
  );
  const domains = useMemo(() => [...new Set(ideas.map((i) => i.domain))].sort(), [ideas]);
  const kinds = useMemo(() => [...new Set(ideas.map((i) => i.kind))].sort(), [ideas]);

  if (cases.isError) return <Failure error={cases.error} what="The use cases" />;
  if (cases.isLoading || board.isLoading || hm.isLoading) return <Loading what="the use cases" />;

  const accepted = rows.filter((r) => r.verdict === "accepted");
  const waiting = rows.filter((r) => (r.verdict === "pending" || r.verdict === "untested") && r.origin !== "idea");
  const rejected = rows.filter((r) => r.verdict === "rejected");
  const openOrder = open ? open.order.map((id) => byId.get(id)).filter((i): i is CaseIdea => !!i) : [];
  const openIdea = open ? byId.get(open.id) : undefined;

  return (
    <div className="bd-cases" data-testid="board-cases">
      <p className="bd-lib__intro">
        A use case is judged on its own here, without an art style. Approve stories that hold for a decade or all time
        ({cases.data?.min_span_years ?? 10}+ years) and reveal something as the clock runs. Ideas come from{" "}
        <code className="mono">node .claude/skills/board/scripts/board.mjs cases --id cs-002</code>.
      </p>

      <section className="bd-lib__group" aria-labelledby="cs-inbox">
        <header className="bd-lib__gh">
          <h2 id="cs-inbox">
            Ideas inbox <span className="num">{inbox(ideas).length}</span>
          </h2>
          <p>
            Enter opens an idea · in the idea <kbd>A</kbd> accept <kbd>N</kbd> not interesting <kbd>S</kbd> too short{" "}
            <kbd>I</kbd> no insight <kbd>D</kbd> no data <kbd>U</kbd> duplicate · <kbd>←</kbd>
            <kbd>→</kbd> step · <kbd>Esc</kbd> back
          </p>
        </header>
        {ideas.length ? (
          <div className="bd-cs__filters">
            <Seg label="Domain" value={domain} set={setDomain} opts={domains.map((d) => [d, DOMAIN_LABEL[d as CaseIdea["domain"]] ?? d])} />
            {kinds.length > 1 ? (
              <Seg label="Kind" value={kind} set={setKind} opts={kinds.map((k) => [k, KIND_LABEL[k as CaseIdea["kind"]] ?? k])} />
            ) : null}
            <span className="bd-filters__n num">{pending.length} undecided in view</span>
          </div>
        ) : null}
        {pending.length ? (
          <TitleList ideas={pending} onOpen={(id) => setOpen({ id, order: pending.map((i) => i.id) })} />
        ) : (
          <Empty title="No ideas waiting" className="bd-empty">
            Run the case loop to brainstorm use cases across domains, without art style.
          </Empty>
        )}
      </section>

      <CaseList id="cs-acc" title="Accepted" hint="Loops build designs on these." rows={accepted} onOpen={setOpen} />
      <CaseList id="cs-wait" title="Waiting on designs" hint="Registry formats and design proposals with no verdict yet." rows={waiting} onOpen={setOpen} />
      <CaseList id="cs-rej" title="Rejected" hint="Kept so loops do not propose them again." rows={rejected} onOpen={setOpen} />

      {open && openIdea ? (
        <IdeaDialog
          idea={openIdea}
          order={openOrder}
          onGo={(id) => setOpen((o) => (o ? { ...o, id } : o))}
          onClose={() => {
            const last = open.id;
            setOpen(null);
            requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-idea="${last}"]`)?.focus());
          }}
        />
      ) : null}
    </div>
  );
}

function Seg({ label, value, set, opts }: { label: string; value: string; set: (v: string) => void; opts: [string, string][] }) {
  return (
    <fieldset className="seg seg--sm">
      <legend className="sr-only">{label}</legend>
      <button type="button" aria-pressed={value === "all"} onClick={() => set("all")}>
        All {label.toLowerCase()}s
      </button>
      {opts.map(([v, l]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => set(v)}>
          {l}
        </button>
      ))}
    </fieldset>
  );
}

// ---------------------------------------------------------------- layer 1: titles

function TitleList({ ideas, onOpen }: { ideas: CaseIdea[]; onOpen: (id: string) => void }) {
  const ref = useRef<HTMLOListElement>(null);
  const onKey = (e: KeyboardEvent<HTMLOListElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const btns = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button[data-idea]") ?? [])];
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    const to = e.key === "Home" ? 0 : e.key === "End" ? btns.length - 1 : Math.max(0, Math.min(btns.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)));
    e.preventDefault();
    btns[to]?.focus();
  };
  return (
    <ol className="bd-titles" ref={ref} onKeyDown={onKey} aria-label="Undecided ideas">
      {ideas.map((i, n) => (
        <li key={i.id}>
          <button type="button" data-idea={i.id} data-testid={`title-${i.id}`} onClick={() => onOpen(i.id)}>
            <span className="bd-titles__n num">{n + 1}</span>
            <span className="bd-tag">{DOMAIN_LABEL[i.domain]}</span>
            <b className="bd-titles__t">{i.title}</b>
            {i.kind !== "observed" ? <span className={`bd-tag bd-tag--${i.kind}`}>{KIND_LABEL[i.kind]}</span> : null}
            <span className="bd-titles__span mono">
              {i.timeline.years_from}–{i.timeline.years_to}
            </span>
            <span className="bd-titles__pitch">{i.pitch}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

function CaseList({
  id,
  title,
  hint,
  rows,
  onOpen,
}: {
  id: string;
  title: string;
  hint: string;
  rows: CaseRow[];
  onOpen: (o: { id: string; order: string[] }) => void;
}) {
  if (!rows.length) return null;
  const order = rows.filter((r) => r.idea).map((r) => r.key);
  return (
    <section className="bd-lib__group" aria-labelledby={id}>
      <header className="bd-lib__gh">
        <h2 id={id}>
          {title} <span className="num">{rows.length}</span>
        </h2>
        <p>{hint}</p>
      </header>
      <ul className="bd-caselist">
        {rows.map((r) => (
          <li key={r.key} className={`bd-caserow bd-caserow--${r.verdict}`}>
            <div className="bd-caserow__main">
              <b>{r.name}</b>
              <span className={`bd-tag bd-tag--${r.origin}`}>{ORIGIN_WORD[r.origin]}</span>
              {r.idea ? <span className="bd-tag">{DOMAIN_LABEL[r.idea.domain]}</span> : null}
              {r.idea && r.idea.kind !== "observed" ? <span className={`bd-tag bd-tag--${r.idea.kind}`}>{KIND_LABEL[r.idea.kind]}</span> : null}
              {r.span ? <span className="bd-caserow__span mono">{r.span}</span> : null}
              {r.origin !== "idea" ? (
                <span className="bd-caserow__tally num">
                  {r.accepts} accepted · {r.case_rejects} case-rejected · {r.pending} pending
                </span>
              ) : r.idea?.decision ? (
                <span className="bd-caserow__tally">{CASE_DECISION_META[r.idea.decision].label}</span>
              ) : null}
              {r.idea ? (
                <button type="button" className="bd-linkbtn" data-idea={r.key} onClick={() => onOpen({ id: r.key, order })}>
                  Open
                </button>
              ) : null}
            </div>
            {r.pitch ? <p className="bd-caserow__pitch">{r.pitch}</p> : null}
            {r.chart ? <p className="bd-caserow__chart">Chart: {r.chart}</p> : null}
            {r.note ? (
              <p className="bd-caserow__note">
                <b>Your note</b> {r.note}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------- layer 2: the idea

function IdeaDialog({
  idea,
  order,
  onGo,
  onClose,
}: {
  idea: CaseIdea;
  order: CaseIdea[];
  onGo: (id: string) => void;
  onClose: () => void;
}) {
  const dlg = useRef<HTMLDialogElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const decide = useDecideCase();
  const [note, setNote] = useState(idea.note ?? "");
  const idx = order.findIndex((i) => i.id === idea.id);
  const prev = idx > 0 ? order[idx - 1] : undefined;
  const next = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : undefined;
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on every idea change
  useEffect(() => {
    setNote(idea.note ?? "");
    dlg.current?.querySelector(".bd-idlg__body")?.scrollTo({ top: 0 });
  }, [idea.id]);

  const send = (d: CaseDecision) =>
    decide.mutate(
      { id: idea.id, decision: d, note },
      {
        onSuccess: (saved) => {
          const after = order.map((o) => (o.id === saved.id ? saved : o));
          const to = nextUndecided(after, saved.id);
          if (to) onGo(to);
        },
      },
    );

  const onKey = (e: KeyboardEvent<HTMLDialogElement>) => {
    if ((e.target as HTMLElement).closest("input, textarea, select") || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "ArrowLeft" && prev) {
      e.preventDefault();
      onGo(prev.id);
    } else if (e.key === "ArrowRight" && next) {
      e.preventDefault();
      onGo(next.id);
    } else {
      const d = caseDecisionForKey(e.key);
      if (d && !decide.isPending) {
        e.preventDefault();
        send(d);
      }
    }
  };

  const allDone = !nextUndecided(order, idea.id) && !!idea.decision;
  return (
    <dialog
      ref={dlg}
      className="bd-lb bd-idlg"
      aria-labelledby="bd-idlg-title"
      onCancel={(e) => {
        e.preventDefault();
        shut();
      }}
      onKeyDown={onKey}
      onClick={(e) => {
        if (e.target === dlg.current) shut();
      }}
      data-testid="idea-dialog"
    >
      <div className="bd-lb__top">
        <span className="label num">
          Idea {idx + 1} of {order.length}
        </span>
        <div className="bd-lb__nav">
          <button type="button" className="btn btn--ghost btn--sm" disabled={!prev} onClick={() => prev && onGo(prev.id)}>
            Previous <kbd>←</kbd>
          </button>
          <button type="button" className="btn btn--ghost btn--sm" disabled={!next} onClick={() => next && onGo(next.id)}>
            Next <kbd>→</kbd>
          </button>
        </div>
        <button ref={closeBtn} type="button" className="btn btn--sm bd-lb__close" onClick={shut}>
          Back to list <kbd>Esc</kbd>
        </button>
      </div>

      <div className="bd-idlg__body">
        <IdeaBody idea={idea} />
      </div>

      <div className="bd-lb__bar bd-idlg__bar">
        <label className="sr-only" htmlFor={`cn-${idea.id}`}>
          Note on {idea.title}
        </label>
        <input
          id={`cn-${idea.id}`}
          className="bd-idea__note"
          placeholder="Optional note for the next loop (type here, keys pause while typing)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="bd-idea__btns">
          {CASE_DECISIONS.map((d) => (
            <button
              key={d}
              type="button"
              title={CASE_DECISION_META[d].hint}
              className={`btn btn--sm ${d === "accept" ? "btn--primary" : "btn--ghost"} ${idea.decision === d ? "is-current" : ""}`}
              aria-pressed={idea.decision === d}
              aria-keyshortcuts={CASE_DECISION_META[d].key.toUpperCase()}
              disabled={decide.isPending}
              data-testid={`idea-${idea.id}-${d}`}
              onClick={() => send(d)}
            >
              {CASE_DECISION_META[d].label} <kbd>{CASE_DECISION_META[d].key.toUpperCase()}</kbd>
            </button>
          ))}
        </div>
        <div className="bd-lb__after" aria-live="polite">
          {decide.isError ? (
            <span className="bd-style__err">{serverError(decide.error)}</span>
          ) : idea.decision ? (
            <span className="bd-dim">
              Decided: {CASE_DECISION_META[idea.decision].label}
              {allDone ? " · every idea in view is decided" : ""}
            </span>
          ) : null}
        </div>
      </div>
    </dialog>
  );
}

function IdeaBody({ idea }: { idea: CaseIdea }) {
  const t = idea.timeline;
  return (
    <article className={`bd-idea bd-idea--${idea.status}`} data-testid={`idea-${idea.id}`}>
      <header className="bd-idea__head">
        <div className="bd-idea__tags">
          <span className="bd-tag">{DOMAIN_LABEL[idea.domain]}</span>
          {idea.kind !== "observed" ? <span className={`bd-tag bd-tag--${idea.kind}`}>{KIND_LABEL[idea.kind]}</span> : null}
        </div>
        <h2 className="bd-lb__title" id="bd-idlg-title">
          {idea.title}
        </h2>
        <span className="bd-idea__span mono">
          {t.years_from}–{t.years_to} · {idea.span_years} yrs · by {t.unit}
        </span>
      </header>
      <p className="bd-idea__pitch">{idea.pitch}</p>
      <dl className="bd-idea__dl">
        <div>
          <dt>Over time</dt>
          <dd>{idea.arc}</dd>
        </div>
        <div>
          <dt>Insight</dt>
          <dd>{idea.insight}</dd>
        </div>
        <div>
          <dt>Tension · {idea.tension.strength}</dt>
          <dd>
            You'd expect {lowerFirst(idea.tension.expectation)}; the data shows {lowerFirst(idea.tension.reality)}.
          </dd>
        </div>
        {idea.method ? (
          <div>
            <dt>{idea.kind === "what-if" ? "Scenario method" : "How influence is measured"}</dt>
            <dd>{idea.method}</dd>
          </div>
        ) : null}
        {idea.beats.length ? (
          <div>
            <dt>Beats</dt>
            <dd>
              <ol className="bd-idea__beats">
                {idea.beats.map((b) => (
                  <li key={`${b.at}-${b.what}`}>
                    <b className="mono">{b.at}</b> {b.what}
                  </li>
                ))}
              </ol>
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Why it lasts</dt>
          <dd>{idea.why_lasts}</dd>
        </div>
        {idea.chart_ideas.length ? (
          <div>
            <dt>Could look like</dt>
            <dd>{idea.chart_ideas.join(" · ")}</dd>
          </div>
        ) : null}
        {idea.unknowns.length ? (
          <div>
            <dt>Cannot claim</dt>
            <dd>{idea.unknowns.join(" · ")}</dd>
          </div>
        ) : null}
      </dl>
      <div className={`bd-idea__data bd-idea__data--${idea.data_status}`}>
        <b>
          {DATA_STATUS_LABEL[idea.data_status]}
          {idea.feasibility ? ` · feasibility ${idea.feasibility}` : ""}
        </b>
        {idea.data_guess ? <p className="bd-idea__guess">{idea.data_guess}</p> : null}
        {idea.sources.length ? (
          <ul>
            {idea.sources.map((s) => (
              <li key={`${s.name}-${s.url ?? ""}`}>
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noreferrer noopener">
                    {s.name}
                  </a>
                ) : (
                  s.name
                )}
                {s.license ? <span className="mono"> {s.license}</span> : null}
                {s.coverage ? <span> · {s.coverage}</span> : null}
                {s.registry_id ? <span className="mono"> · registry: {s.registry_id}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </article>
  );
}
