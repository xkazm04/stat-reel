/**
 * The Archived tab (entity-lifecycle: archive-restore-semantics): the designs and use case ideas hidden from
 * every other view, each with the reason it was archived and a Restore that puts it back where it left
 * (decision kept; a superseded sibling returns to pending). Read-only otherwise: an archived row cannot be
 * decided or undone, the server refuses both. Same card pattern as the rejected lane; Restore offers the
 * Board's undo toast (which archives it again with its own reason).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type BoardItem, type CaseIdea, qk, serverError } from "../api";
import { Empty, Failure, Loading } from "../components/ui";
import { type ArchiveReason, archiveReason, decisionWords, isSuperseded, reArchiveReason, restoreLabel } from "./archived";
import { caseOf, ratioOf, styleOf } from "./board";
import { DOMAIN_LABEL } from "./library";
import { CaseChip, Shot, shotAlt, useFlash } from "./shared";
import { showUndo } from "./undo";

/** shot height on a card (px), like the rejected lane */
const SHOT_H = 200;

type Target = { kind: "item" | "idea"; id: string; title: string; reason: ArchiveReason };

/** POST /api/{board|cases}/:id/restore, then the toast whose Undo archives the row again with the same reason. */
function useRestore() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (t: Target) => {
      if (t.kind === "item") await api.restoreBoardItem(t.id);
      else await api.restoreCase(t.id);
      return t;
    },
    onSuccess: (t) => {
      void qc.invalidateQueries({ queryKey: qk.board }); // the prefix covers the archived list too
      void qc.invalidateQueries({ queryKey: qk.cases });
      void qc.invalidateQueries({ queryKey: qk.styles });
      const again = reArchiveReason(t.reason);
      showUndo(`Restored · ${t.title}`, () =>
        t.kind === "item" ? api.archiveBoard([t.id], again) : api.archiveCases([t.id], again),
      );
    },
  });
}

function Reason({ reason }: { reason: ArchiveReason }) {
  if (!reason.text) return <p className="bd-dim">No reason recorded.</p>;
  return (
    <p className="bd-gate__said">
      <span className="label">Archived because</span> “{reason.text}”
      {reason.legacy ? (
        <span className="bd-dim"> (kept in the note, from before reasons had their own field)</span>
      ) : null}
    </p>
  );
}

export function ArchivedView({ names }: { names: ReadonlyMap<string, string> }) {
  const items = useQuery({ queryKey: qk.boardArchived, queryFn: () => api.boardArchived() });
  const ideas = useQuery({ queryKey: qk.casesArchived, queryFn: () => api.casesArchived() });
  const restore = useRestore();
  const [busy, flashBusy] = useFlash();

  const act = (t: Target) => {
    if (restore.isPending) {
      flashBusy();
      return;
    }
    restore.mutate(t);
  };

  if (items.isError)
    return <Failure error={items.error} what="The archived designs" onRetry={() => void items.refetch()} />;
  if (ideas.isError)
    return <Failure error={ideas.error} what="The archived use cases" onRetry={() => void ideas.refetch()} />;
  if (items.isLoading || ideas.isLoading) return <Loading what="the archive" />;

  const designs: BoardItem[] = items.data?.items.filter((i) => i.status === "archived") ?? [];
  const cases: CaseIdea[] = ideas.data?.ideas.filter((i) => i.status === "archived") ?? [];

  return (
    <div className="bd-arch" data-testid="archived-view">
      <p className="bd-rl__intro">
        <span>
          Archived rows stay out of every other view, and their files and decisions are kept. <b>Restore</b> puts one
          back where it left.
        </span>
        {busy ? (
          <b className="bd-busy" role="status">
            Still restoring the last one, try again
          </b>
        ) : null}
      </p>

      <section className="bd-rl" aria-label="Archived designs" data-testid="archived-designs">
        <h2 className="bd-arch__h">
          Designs <span className="num">{designs.length}</span>
        </h2>
        {designs.length ? (
          <ul className="bd-rl__list">
            {designs.map((it) => {
              const reason = archiveReason(it, "item");
              const ratio = ratioOf(it.width, it.height);
              return (
                <li key={it.id} className="bd-rl__card" data-testid={`archived-item-${it.id}`}>
                  <span
                    className="bd-rl__img"
                    style={{ aspectRatio: String(ratio), width: `${Math.round(SHOT_H * ratio)}px` }}
                  >
                    <Shot item={it} fit="box" alt={shotAlt(it)} />
                  </span>
                  <div className="bd-rl__body">
                    <h3 className="bd-rl__title">{it.title}</h3>
                    <p className="bd-rl__meta">
                      <span>{styleOf(it).name}</span>
                      <CaseChip kase={caseOf(it, names)} />
                    </p>
                    <Reason reason={reason} />
                    {isSuperseded(it.decision) ? (
                      <p className="bd-dim">Hidden when a sibling variant was accepted; it was never decided.</p>
                    ) : it.decision ? (
                      <p className="bd-dim">
                        Decision kept: <b>{decisionWords("item", it.decision)}</b>
                        {it.note ? <> · “{it.note}”</> : null}
                      </p>
                    ) : null}
                    <div className="bd-rl__btns">
                      <button
                        type="button"
                        className="btn btn--sm btn--primary"
                        data-testid={`archived-restore-${it.id}`}
                        aria-disabled={restore.isPending || undefined}
                        onClick={() => act({ kind: "item", id: it.id, title: it.title, reason })}
                      >
                        {restoreLabel(it.decision)}
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty title="No archived designs" className="bd-empty">
            Nothing has been archived. Off-brief designs and superseded variants land here.
          </Empty>
        )}
      </section>

      <section className="bd-rl" aria-label="Archived use cases" data-testid="archived-cases">
        <h2 className="bd-arch__h">
          Use cases <span className="num">{cases.length}</span>
        </h2>
        {cases.length ? (
          <ul className="bd-rl__list">
            {cases.map((c) => {
              const reason = archiveReason(c, "idea");
              return (
                <li key={c.id} className="bd-rl__card" data-testid={`archived-idea-${c.id}`}>
                  <div className="bd-rl__body">
                    <h3 className="bd-rl__title">{c.title}</h3>
                    <p className="bd-rl__meta">
                      <span>{DOMAIN_LABEL[c.domain] ?? c.domain}</span>
                      <span className="num">{c.span_years} years</span>
                    </p>
                    <p className="bd-dim">{c.pitch}</p>
                    <Reason reason={reason} />
                    {c.decision ? (
                      <p className="bd-dim">
                        Decision kept: <b>{decisionWords("idea", c.decision)}</b>
                        {c.note ? <> · “{c.note}”</> : null}
                      </p>
                    ) : null}
                    <div className="bd-rl__btns">
                      <button
                        type="button"
                        className="btn btn--sm btn--primary"
                        data-testid={`archived-restore-${c.id}`}
                        aria-disabled={restore.isPending || undefined}
                        onClick={() => act({ kind: "idea", id: c.id, title: c.title, reason })}
                      >
                        {restoreLabel(c.decision)}
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty title="No archived use cases" className="bd-empty">
            Nothing has been archived.
          </Empty>
        )}
      </section>

      {restore.isError ? (
        <p className="bd-gate__err" role="alert">
          Not restored: <span className="mono">{serverError(restore.error)}</span>
        </p>
      ) : null}
    </div>
  );
}
