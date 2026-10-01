/**
 * Board · Use cases (ADR 008): the stories, judged apart from any art style. The inbox holds case
 * ideas from the text-only case loop (`board.mjs cases`), each with its decade-plus timeline,
 * tension, sources and data status, behind a gate with typed reasons (too short, no insight, no
 * data, duplicate). Below it, every case the Board knows - registry formats, cases accepted
 * through designs, accepted ideas - grouped by verdict.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api, CASE_DECISIONS, type CaseDecision, type CaseIdea, type CasesResponse, qk, serverError } from "../api";
import { Empty, Failure, Loading } from "../components/ui";
import { useHeatmap } from "../data";
import { CASE_DECISION_META, type CaseRow, caseRows, DATA_STATUS_LABEL, DOMAIN_LABEL, inbox } from "./library";
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

export function CasesView() {
  const cases = useCases();
  const board = useBoard();
  const hm = useHeatmap();
  const [domain, setDomain] = useState<string>("all");
  const ideas = cases.data?.ideas ?? [];
  const rows = useMemo(
    () => caseRows(hm.data?.usecases ?? [], board.data?.items ?? [], ideas),
    [hm.data, board.data, ideas],
  );
  const pending = useMemo(() => inbox(ideas).filter((i) => domain === "all" || i.domain === domain), [ideas, domain]);
  const domains = useMemo(() => [...new Set(ideas.map((i) => i.domain))].sort(), [ideas]);

  if (cases.isError) return <Failure error={cases.error} what="The use cases" />;
  if (cases.isLoading || board.isLoading || hm.isLoading) return <Loading what="the use cases" />;

  const accepted = rows.filter((r) => r.verdict === "accepted");
  const waiting = rows.filter((r) => (r.verdict === "pending" || r.verdict === "untested") && r.origin !== "idea");
  const rejected = rows.filter((r) => r.verdict === "rejected");
  return (
    <div className="bd-cases" data-testid="board-cases">
      <p className="bd-lib__intro">
        A use case is judged on its own here, without an art style. Approve only stories that hold for a decade or
        all time ({cases.data?.min_span_years ?? 10}+ years of data) and reveal something as the clock runs.
        Ideas come from <code className="mono">node .claude/skills/board/scripts/board.mjs cases --id cs-001</code>.
      </p>

      <section className="bd-lib__group" aria-labelledby="cs-inbox">
        <header className="bd-lib__gh">
          <h2 id="cs-inbox">
            Ideas inbox <span className="num">{inbox(ideas).length}</span>
          </h2>
          {domains.length > 1 ? (
            <fieldset className="seg seg--sm">
              <legend className="sr-only">Domain</legend>
              <button type="button" aria-pressed={domain === "all"} onClick={() => setDomain("all")}>
                All
              </button>
              {domains.map((d) => (
                <button key={d} type="button" aria-pressed={domain === d} onClick={() => setDomain(d)}>
                  {DOMAIN_LABEL[d as CaseIdea["domain"]] ?? d}
                </button>
              ))}
            </fieldset>
          ) : null}
        </header>
        {pending.length ? (
          <div className="bd-ideas">
            {pending.map((i) => (
              <IdeaCard key={i.id} idea={i} />
            ))}
          </div>
        ) : (
          <Empty title="No ideas waiting" className="bd-empty">
            Run the case loop to propose use cases, across F1 and new data domains, without art style.
          </Empty>
        )}
      </section>

      <CaseList id="cs-acc" title="Accepted" hint="Loops build designs on these." rows={accepted} />
      <CaseList id="cs-wait" title="Waiting on designs" hint="Registry formats and design proposals with no verdict yet." rows={waiting} />
      <CaseList id="cs-rej" title="Rejected" hint="Kept so loops do not propose them again." rows={rejected} />
    </div>
  );
}

function CaseList({ id, title, hint, rows }: { id: string; title: string; hint: string; rows: CaseRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!rows.length) return null;
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
              {r.span ? <span className="bd-caserow__span mono">{r.span}</span> : null}
              {r.origin !== "idea" ? (
                <span className="bd-caserow__tally num">
                  {r.accepts} accepted · {r.case_rejects} case-rejected · {r.pending} pending
                </span>
              ) : r.idea?.decision ? (
                <span className="bd-caserow__tally">{CASE_DECISION_META[r.idea.decision].label}</span>
              ) : null}
              {r.idea ? (
                <button type="button" className="bd-linkbtn" aria-expanded={open === r.key} onClick={() => setOpen((o) => (o === r.key ? null : r.key))}>
                  {open === r.key ? "Close" : "Open"}
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
            {open === r.key && r.idea ? <IdeaCard idea={r.idea} /> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "Whoever leads" -> "whoever leads" mid-sentence; acronyms ("US", "GDP") stay as they are. */
const lowerFirst = (s: string): string => {
  const x = s.trim().replace(/[.;]+$/, "");
  return /^([A-Z][a-z]|A )/.test(x) ? x[0]!.toLowerCase() + x.slice(1) : x;
};

function IdeaCard({ idea }: { idea: CaseIdea }) {
  const decide = useDecideCase();
  const [note, setNote] = useState(idea.note ?? "");
  const t = idea.timeline;
  return (
    <article className={`bd-idea bd-idea--${idea.status}`} data-testid={`idea-${idea.id}`}>
      <header className="bd-idea__head">
        <span className="bd-tag">{DOMAIN_LABEL[idea.domain]}</span>
        <h3>{idea.title}</h3>
        <span className="bd-idea__span mono">
          {t.years_from}–{t.years_to} · {idea.span_years} yrs · by {t.unit}
        </span>
      </header>
      <p className="bd-idea__pitch">{idea.pitch}</p>
      <dl className="bd-idea__dl">
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
        {idea.chart_ideas.length ? (
          <div>
            <dt>Could look like</dt>
            <dd>{idea.chart_ideas.join(" · ")}</dd>
          </div>
        ) : null}
      </dl>
      <details className="bd-idea__more">
        <summary>
          Details: the arc, {idea.beats.length} beats, why it lasts{idea.unknowns.length ? ", what it cannot claim" : ""}
        </summary>
        <dl className="bd-idea__dl">
          <div>
            <dt>Over time</dt>
            <dd>{idea.arc}</dd>
          </div>
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
          {idea.unknowns.length ? (
            <div>
              <dt>Cannot claim</dt>
              <dd>{idea.unknowns.join(" · ")}</dd>
            </div>
          ) : null}
        </dl>
      </details>
      <div className={`bd-idea__data bd-idea__data--${idea.data_status}`}>
        <b>{DATA_STATUS_LABEL[idea.data_status]}</b>
        <ul>
          {idea.sources.map((s) => (
            <li key={s.url}>
              <a href={s.url} target="_blank" rel="noreferrer noopener">
                {s.name}
              </a>{" "}
              <span className="mono">{s.license}</span>
              {s.coverage ? <span> · {s.coverage}</span> : null}
              {s.class ? <span> · {s.class}</span> : null}
              {s.confidence ? <span> · {s.confidence} confidence</span> : null}
              {s.registry_id ? <span className="mono"> · registry: {s.registry_id}</span> : null}
            </li>
          ))}
        </ul>
      </div>
      <form className="bd-idea__gate" onSubmit={(e) => e.preventDefault()}>
        <label className="sr-only" htmlFor={`cn-${idea.id}`}>
          Note on {idea.title}
        </label>
        <input
          id={`cn-${idea.id}`}
          className="bd-idea__note"
          placeholder="Optional note for the next loop"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="bd-idea__btns">
          {CASE_DECISIONS.map((d) => (
            <button
              key={d}
              type="button"
              title={CASE_DECISION_META[d].hint}
              className={`btn btn--sm ${d === "accept" ? "" : "btn--ghost"} ${idea.decision === d ? "is-current" : ""}`}
              aria-pressed={idea.decision === d}
              disabled={decide.isPending}
              data-testid={`idea-${idea.id}-${d}`}
              onClick={() => decide.mutate({ id: idea.id, decision: d, note })}
            >
              {CASE_DECISION_META[d].label}
            </button>
          ))}
        </div>
        {decide.isError ? <p className="bd-style__err">{serverError(decide.error)}</p> : null}
      </form>
    </article>
  );
}
