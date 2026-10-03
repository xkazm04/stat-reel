/**
 * Left column (parametrisation): the use case and its dataset (the cell's required kinds and the
 * sources that clear them), then the props as a readable form (title, hook shape, metrics, raw vs
 * adjusted ranks with fact keys) or as JSON that POSTs /api/projects/:id/props, errors verbatim.
 * The scenes and their narration live in the script modal (opened from here, the stage bar's
 * Script key, or a scene on the timeline).
 */
import type { EraAdjustedProps, HeatmapCell, Mode, UseCase } from "@statreel/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { api, errorText, type ProjectDetail, qk } from "../api";
import { LicChip, StatusChip } from "../components/glyphs";
import { Empty } from "../components/ui";
import { cellOf, factGroup } from "../logic";
import { fmtValue, kindLong } from "../display";

function Dataset({ usecase, cell }: { usecase: UseCase | undefined; cell: HeatmapCell | undefined }) {
  if (!usecase) return <p className="sum-p">Use case not in the registry.</p>;
  return (
    <div className="ds">
      <div className="ds__h">
        <b>{usecase.name}</b>
        {cell ? <StatusChip status={cell.status} size={13} /> : null}
      </div>
      <p className="ds__m">
        {usecase.duration_s.min}–{usecase.duration_s.max} s · composition {usecase.composition ?? "none"} · schema{" "}
        {usecase.props_schema ?? "none"}
        {usecase.query_templates.length ? ` · templates ${usecase.query_templates.join(", ")}` : ""}
      </p>
      <ul className="ds__kinds">
        {(cell?.kinds ?? usecase.requires.kinds.map((k) => ({ kind: k, best: null, tested: false, sources: [] }))).map(
          (k) => {
            const pass = k.sources.filter((s) => s.status === "pass");
            return (
              <li key={k.kind}>
                <span className="ds__k">{kindLong(k.kind)}</span>
                {pass.length ? (
                  pass.map((s) => (
                    <span key={s.id} className="ds__src">
                      <b className="mono">{s.id}</b> <LicChip cls={s.license_class} />
                    </span>
                  ))
                ) : (
                  <span className="label">{k.tested ? "no passing source" : "not tested"}</span>
                )}
              </li>
            );
          },
        )}
      </ul>
    </div>
  );
}

function Readable({
  props,
  detail,
  onOpenScript,
}: {
  props: EraAdjustedProps;
  detail: ProjectDetail;
  onOpenScript: () => void;
}) {
  const script = detail.script?.script;
  const rows = [...props.rows].sort((a, b) => a.adjusted_rank - b.adjusted_rank);
  const cols = (r: EraAdjustedProps["rows"][number]) =>
    [r.raw_rank_fact_key, r.adjusted_rank_fact_key, r.raw_fact_key, r.adjusted_fact_key].map((k) =>
      k.slice(k.lastIndexOf("#")),
    );
  const shared = rows.every((r) => cols(r).join() === cols(rows[0] ?? r).join()) && rows[0] ? cols(rows[0]) : null;
  return (
    <div className="pf">
      <dl className="pf__kv">
        <div>
          <dt>Title</dt>
          <dd className="pf__title">{props.title}</dd>
        </div>
        <div>
          <dt>Hook shape</dt>
          <dd>{props.hook_shape}</dd>
        </div>
        <div>
          <dt>Format</dt>
          <dd>{props.format}</dd>
        </div>
        <div>
          <dt>Raw metric</dt>
          <dd>{props.metric_raw_label}</dd>
        </div>
        <div>
          <dt>Adjusted metric</dt>
          <dd>{props.metric_adjusted_label}</dd>
        </div>
      </dl>
      <h3 className="sec-h">
        <span>Rows · raw vs era-adjusted · {props.rows.length}</span>
      </h3>
      {shared ? (
        <p className="rows-facts mono">
          Every figure cites its fact: <b>{"<row fact_key>"}</b> {shared.join(" · ")} (raw rank · adjusted rank · raw
          value · adjusted value)
        </p>
      ) : null}
      <div className="table-wrap">
        <table className="tbl tbl--rows">
          <thead>
            <tr>
              <th>Name</th>
              <th className="num">Rank raw → adj.</th>
              <th className="num">Value raw → adj.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const up = r.adjusted_rank < r.raw_rank;
              const g = factGroup([r.raw_rank_fact_key, r.adjusted_rank_fact_key, r.raw_fact_key, r.adjusted_fact_key]);
              return (
                <tr key={r.player_id} className={r.player_id === props.highlight_player_id ? "is-hi" : ""}>
                  <td>
                    {r.name}
                    <span
                      className="tbl__sub mono"
                      title={g.prefix ? `${g.prefix} # ${g.columns.join(", ")}` : g.columns.join(" · ")}
                    >
                      {g.prefix ? (shared ? g.prefix : `${g.prefix} # ${g.columns.join(", ")}`) : g.columns.join(" · ")}
                    </span>
                  </td>
                  <td className="num">
                    {r.raw_rank} → <b className={up ? "is-up" : "is-down"}>{r.adjusted_rank}</b>
                  </td>
                  <td className="num">
                    {fmtValue(r.raw_value)} → <b>{fmtValue(r.adjusted_value)}</b>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="pf__script">
        <span>
          <b className="num">{props.scenes.length}</b> scenes ·{" "}
          {script ? `script v${detail.script?.version}` : "no script yet"}
        </span>
        <button type="button" className="btn btn--sm btn--ghost" onClick={onOpenScript}>
          Open the script
        </button>
      </div>
      <dl className="pf__kv">
        <div>
          <dt>Attribution</dt>
          <dd>{props.attribution}</dd>
        </div>
        <div>
          <dt>Method</dt>
          <dd>{props.method_note}</dd>
        </div>
        <div>
          <dt>Timing</dt>
          <dd>
            {props.timing
              ? `${props.timing.duration_s.toFixed(1)} s · ${props.timing.cues.length} caption cues · ${props.timing.music.length} music cues`
              : "none yet (Produce generates it)"}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function JsonEdit({ detail, onDone }: { detail: ProjectDetail; onDone: () => void }) {
  const qc = useQueryClient();
  const initial = detail.props ? JSON.stringify(detail.props.props, null, 2) : "";
  const [text, setText] = useState(initial);
  const [errors, setErrors] = useState<string[] | null>(null);
  const save = useMutation({
    mutationFn: (body: unknown) => api.setProps(detail.project.id, body),
    onSuccess: (r) => {
      if (r.errors.length) setErrors(r.errors);
      else {
        setErrors(null);
        void qc.invalidateQueries({ queryKey: qk.project(detail.project.id) });
        onDone();
      }
    },
  });
  const submit = () => {
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch (e) {
      setErrors([`JSON: ${errorText(e)}`]);
      return;
    }
    save.mutate(body);
  };
  return (
    <div className="json">
      <label className="sr-only" htmlFor="props-json">
        Props JSON
      </label>
      <textarea
        id="props-json"
        className="json__ta mono"
        spellCheck={false}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="json__bar">
        <button
          type="button"
          className="btn btn--primary btn--sm"
          onClick={submit}
          disabled={save.isPending || !text.trim()}
        >
          {save.isPending ? "Validating" : "Save props"}
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setText(initial)}>
          Reset
        </button>
        <span className="label">Every figure is checked against the fact it cites</span>
      </div>
      {save.isError ? <p className="joberr">{errorText(save.error)}</p> : null}
      {errors ? (
        <ul className="json__errs" role="alert">
          {errors.map((e) => (
            <li key={e} className="mono">
              {e}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function PropsPanel({
  detail,
  usecase,
  cells,
  onOpenScript,
}: {
  detail: ProjectDetail;
  usecase: UseCase | undefined;
  cells: HeatmapCell[];
  onOpenScript: () => void;
}) {
  const [mode, setMode] = useState<"read" | "json">("read");
  const p = detail.project;
  const cell = cellOf(cells, p.use_case_id, p.sport, p.mode as Mode);
  const props = detail.props?.props;
  return (
    <section className="props panel-col" aria-labelledby="h-props">
      <div className="col-h">
        <h2 id="h-props" className="sec-h">
          <span>Use case · dataset</span>
          <Link
            to="/heatmap/$usecase/$sport"
            params={{ usecase: p.use_case_id, sport: p.sport }}
            search={{ mode: p.mode as Mode }}
            className="sec-h__a"
          >
            heatmap cell
          </Link>
        </h2>
        <Dataset usecase={usecase} cell={cell} />
      </div>
      <div className="col-h col-h--row">
        <h2 className="sec-h">
          <span>Props{detail.props ? ` · v${detail.props.version} by ${detail.props.created_by}` : ""}</span>
        </h2>
        <div className="seg seg--sm" role="group" aria-label="Props view">
          <button type="button" aria-pressed={mode === "read"} onClick={() => setMode("read")}>
            Read
          </button>
          <button type="button" aria-pressed={mode === "json"} onClick={() => setMode("json")}>
            JSON
          </button>
        </div>
      </div>
      <div className="col-body">
        {mode === "json" ? (
          <JsonEdit key={detail.props?.version ?? 0} detail={detail} onDone={() => setMode("read")} />
        ) : props ? (
          <Readable props={props} detail={detail} onOpenScript={onOpenScript} />
        ) : (
          <Empty title="No props yet">
            Draft with Claude: the co-pilot queries the warehouse and stores props whose figures cite facts. Or paste
            props in JSON.
          </Empty>
        )}
      </div>
    </section>
  );
}
