/**
 * Board · Styles (ADR 008): every style the loops produced, as a gallery grouped by status. A
 * style's verdict comes from the gate on its designs; on top of it the owner can lock it (a
 * signature loops rebuild faithfully), retire it (no longer built on), note it and pick its hero
 * design. The board skill reads this library into the next brief.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api, type BoardItem, qk, type StyleEntry, type StylePatch, serverError } from "../api";
import { Card } from "../components/Card";
import { Empty, Failure, Loading } from "../components/ui";
import { atRiskCount, atRiskWords, DEFAULT_STYLE_FILTER, filterStyles, groupStyles, rejectSplitWords, type StyleFilter, styleItems } from "./library";
import { Shot, shotAlt, useBoard } from "./shared";

const STATUS_WORD: Record<StyleEntry["status"], string> = {
  locked: "Locked",
  accepted: "Accepted",
  open: "Not judged",
  retired: "Retired",
  rejected: "Rejected",
};

function useStyles() {
  return useQuery({ queryKey: qk.styles, queryFn: () => api.styles() });
}

function usePatchStyle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; patch: StylePatch }) => api.updateStyle(v.id, v.patch),
    onSuccess: (s) => {
      qc.setQueryData<{ styles: StyleEntry[] }>(qk.styles, (prev) =>
        prev ? { styles: prev.styles.map((x) => (x.id === s.id ? s : x)) } : prev,
      );
      void qc.invalidateQueries({ queryKey: qk.styles });
    },
  });
}

export function StylesView({ names }: { names: ReadonlyMap<string, string> }) {
  const styles = useStyles();
  const board = useBoard();
  const byId = useMemo(() => new Map((board.data?.items ?? []).map((i) => [i.id, i])), [board.data]);
  const [filter, setFilter] = useState<StyleFilter>(DEFAULT_STYLE_FILTER);
  const groups = useMemo(() => groupStyles(filterStyles(styles.data?.styles ?? [], filter)), [styles.data, filter]);
  const [open, setOpen] = useState<string | null>(null);

  if (styles.isError) return <Failure error={styles.error} what="The style library" />;
  // every hero and design list comes from the board: a failed read would show styles with no designs at all
  if (board.isError) return <Failure error={board.error} what="The board" onRetry={() => void board.refetch()} />;
  if (styles.isLoading || board.isLoading) return <Loading what="the style library" />;
  const listed = styles.data?.styles ?? [];
  if (!listed.length)
    return (
      <Empty title="No styles yet" className="bd-empty">
        Styles appear as soon as a loop posts designs. Accept designs on the Designs tab to grow the pool.
      </Empty>
    );

  const all = listed;
  const atRisk = atRiskCount(all);
  const n = (s: StyleEntry["status"]) => all.filter((x) => x.status === s).length;
  return (
    <div className="bd-lib" data-testid="board-styles">
      <p className="bd-lib__intro">
        <b className="num">{n("locked")}</b> locked · <b className="num">{n("accepted")}</b> accepted ·{" "}
        <b className="num">{n("open")}</b> not judged · <b className="num">{n("retired")}</b> retired ·{" "}
        <b className="num">{n("rejected")}</b> rejected{filter.showRejected || filter.atRiskOnly ? "" : " (hidden unless you show them)"}. Loops build on accepted and locked styles, rebuild
        locked ones faithfully, and never reuse retired or rejected ones. Text size is not part of a style.
      </p>
      <fieldset className="bd-lib__filters" data-testid="style-filters">
        <legend className="sr-only">Which styles to list</legend>
        <label>
          <input type="checkbox" checked={filter.showRejected} disabled={filter.atRiskOnly} data-testid="style-filter-rejected" onChange={(e) => setFilter((f) => ({ ...f, showRejected: e.target.checked }))} />
          Show rejected styles <span className="num">({n("rejected")})</span>
        </label>
        <label>
          <input type="checkbox" checked={filter.atRiskOnly} data-testid="style-filter-atrisk" onChange={(e) => setFilter((f) => ({ ...f, atRiskOnly: e.target.checked }))} />
          Only styles at risk <span className="num">({atRisk})</span>
        </label>
      </fieldset>
      {!groups.length ? (
        <Empty title={filter.atRiskOnly ? "No style is at risk" : "No styles to show"} className="bd-empty">
          {filter.atRiskOnly
            ? "At risk means the latest decision was a style reject while the verdict has not flipped. None is in that state."
            : "Every style so far was rejected, so none is listed. Show rejected styles above, or let the loops keep reading them as feedback."}
        </Empty>
      ) : null}
      {groups.map((g) => (
        <Card key={g.status} className={`bd-lib__group bd-lib__group--${g.status}`} title={g.title} titleId={`sg-${g.status}`} tag={g.styles.length}>
          <p className="bd-lib__hint">{g.hint}</p>
          <div className="bd-lib__grid">
            {g.styles.map((s) => (
              <StyleCard
                key={s.id}
                style={s}
                items={styleItems(s, byId)}
                names={names}
                open={open === s.id}
                onToggle={() => setOpen((o) => (o === s.id ? null : s.id))}
              />
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

function StyleCard({
  style,
  items,
  names,
  open,
  onToggle,
}: {
  style: StyleEntry;
  items: BoardItem[];
  names: ReadonlyMap<string, string>;
  open: boolean;
  onToggle: () => void;
}) {
  const patch = usePatchStyle();
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(style.owner_note ?? "");
  const hero = items[0];
  const risk = atRiskWords(style);
  const send = (p: StylePatch) => patch.mutate({ id: style.id, patch: p });
  const caseName = (k: string) => (k.startsWith("proposed:") ? k.slice(9) : (names.get(k) ?? k));

  return (
    <article className={`bd-style bd-style--${style.status}`} data-testid={`style-${style.id}`}>
      <div className="bd-style__hero">{hero ? <Shot item={hero} fit="box" alt={shotAlt(hero)} /> : null}</div>
      <div className="bd-style__body">
        <header className="bd-style__head">
          <h3>{style.name}</h3>
          <span className={`bd-style__mark bd-style__mark--${style.status}`}>{STATUS_WORD[style.status]}</span>
        </header>
        <p className="bd-style__tally num">
          {style.accepts} accepted · {rejectSplitWords(style) ?? "0 style-rejected"} · {style.pending} pending · {style.total}{" "}
          design{style.total === 1 ? "" : "s"}
        </p>
        {risk ? (
          <p className="bd-style__risk" data-testid={`style-atrisk-${style.id}`}>
            <b className="bd-style__risk-t">
              <span aria-hidden="true">▲ </span>At risk
            </b>{" "}
            {risk}
          </p>
        ) : null}
        {style.notes ? <p className="bd-style__notes">{style.notes}</p> : null}
        {style.owner_note && !editing ? (
          <p className="bd-style__owner">
            <b>Your note</b> {style.owner_note}
          </p>
        ) : null}
        <ul className="bd-style__cases" aria-label="Use cases tried">
          {style.cases.map((k) => (
            <li key={k}>{caseName(k)}</li>
          ))}
        </ul>
        {editing ? (
          <form
            className="bd-style__note"
            onSubmit={(e) => {
              e.preventDefault();
              send({ note });
              setEditing(false);
            }}
          >
            <label className="sr-only" htmlFor={`note-${style.id}`}>
              Note on {style.name}
            </label>
            <textarea id={`note-${style.id}`} value={note} rows={2} onChange={(e) => setNote(e.target.value)} />
            <div className="bd-style__row">
              <button type="submit" className="btn btn--sm">
                Save note
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : null}
        <div className="bd-style__row">
          {style.status === "accepted" ? (
            <button type="button" className="btn btn--sm" onClick={() => send({ status: "locked" })}>
              Lock as signature
            </button>
          ) : null}
          {style.status === "locked" ? (
            <button type="button" className="btn btn--sm" onClick={() => send({ status: null })}>
              Unlock
            </button>
          ) : null}
          {style.status === "accepted" || style.status === "locked" ? (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => send({ status: "retired" })}>
              Retire
            </button>
          ) : null}
          {style.status === "retired" ? (
            <button type="button" className="btn btn--sm" onClick={() => send({ status: null })}>
              Restore
            </button>
          ) : null}
          {!editing ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => {
                setNote(style.owner_note ?? "");
                setEditing(true);
              }}
            >
              {style.owner_note ? "Edit note" : "Add note"}
            </button>
          ) : null}
          {items.length > 1 ? (
            <button type="button" className="bd-linkbtn" aria-expanded={open} onClick={onToggle}>
              {open ? "Hide designs" : `All ${items.length} designs`}
            </button>
          ) : null}
        </div>
        {patch.isError ? <p className="bd-style__err">{serverError(patch.error)}</p> : null}
        {open ? (
          <ul className="bd-style__all" aria-label={`Designs in ${style.name}`}>
            {items.map((i) => (
              <li key={i.id}>
                <img src={i.image_url} alt={shotAlt(i)} loading="lazy" decoding="async" />
                <span className="bd-style__cap">{i.title}</span>
                {i.id === style.hero_item_id ? (
                  <span className="bd-style__cap mono">HERO</span>
                ) : (
                  <button type="button" className="bd-linkbtn" onClick={() => send({ hero_item_id: i.id })}>
                    Make hero
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </article>
  );
}
