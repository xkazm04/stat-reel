/** Left rack: use case + dataset and the props, as a readable form or raw JSON (validated by the server). */
import type { EraAdjustedProps, UseCase } from "@statreel/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, errorText, type ProjectDetail, qk } from "../api";
import { KindPin, Led } from "../components/glyphs";
import { Module, Toggle } from "../components/ui";
import { factGroup, relTime } from "../logic";

export function PropsPanel({ detail, usecase }: { detail: ProjectDetail; usecase: UseCase | undefined }) {
  const [view, setView] = useState<"form" | "json">("form");
  const cur = detail.props;
  const p = cur?.props;
  return (
    <Module
      id="m-props"
      title="Dataset · props"
      tag={cur ? `v${cur.version} · by ${cur.created_by}` : "no props yet"}
      className="mod props-mod"
      actions={
        <Toggle
          label="Props view"
          value={view}
          onChange={setView}
          testIdPrefix="props-view-"
          options={[
            { value: "form", label: "Form" },
            { value: "json", label: "JSON" },
          ]}
        />
      }
    >
      <dl className="facts compact">
        <dt>Use case</dt>
        <dd>
          {usecase?.name ?? detail.project.use_case_id}{" "}
          {usecase ? (
            <span className="pins">
              {usecase.requires.kinds.map((k) => (
                <KindPin key={k} kind={k} />
              ))}
            </span>
          ) : null}
        </dd>
        <dt>Dataset</dt>
        <dd className="mono">
          {detail.project.sport} · llm.* views
          {usecase?.requires.min_seasons ? ` · ≥ ${usecase.requires.min_seasons} seasons` : ""}
        </dd>
        {usecase ? (
          <>
            <dt>Duration</dt>
            <dd className="mono">
              {usecase.duration_s.min}–{usecase.duration_s.max} s band
            </dd>
          </>
        ) : null}
        {detail.props_history.length > 1 ? (
          <>
            <dt>History</dt>
            <dd className="mono">
              {detail.props_history
                .slice(0, 4)
                .map((h) => `v${h.version} ${h.created_by} ${relTime(h.created_at)}`)
                .join(" · ")}
            </dd>
          </>
        ) : null}
      </dl>
      <div className="props-scroll">
        {view === "json" ? <JsonEditor detail={detail} /> : p ? <PropsForm p={p} /> : <NoProps />}
      </div>
    </Module>
  );
}

function NoProps() {
  return (
    <div className="display empty">
      <b>No props yet.</b> Press <b>Draft with Claude</b>: the co-pilot queries the llm.* views and stores fact-bound
      props here. You can also paste props in JSON mode.
    </div>
  );
}

function PropsForm({ p }: { p: EraAdjustedProps }) {
  const hi = p.highlight_player_id;
  return (
    <>
      <dl className="facts compact">
        <dt>Title</dt>
        <dd className="p-title">{p.title}</dd>
        <dt>Hook shape</dt>
        <dd>
          <span className="kind-pin">{p.hook_shape}</span>
        </dd>
        <dt>Format</dt>
        <dd className="mono">{p.format}</dd>
        <dt>Metrics</dt>
        <dd>
          raw: {p.metric_raw_label}
          <br />
          adjusted: {p.metric_adjusted_label} <span className="lic lic-legal">era-adjusted</span>
        </dd>
        <dt>Safe zone</dt>
        <dd className="mono">{p.show_safe_zone ? "overlay on" : "overlay off"}</dd>
      </dl>

      <h4 className="subhead">Rows · raw vs adjusted rank</h4>
      <table className="rtable">
        <thead>
          <tr>
            <th scope="col">Driver</th>
            <th scope="col" className="numc">
              Raw
            </th>
            <th scope="col" className="numc">
              Adj
            </th>
            <th scope="col" className="numc">
              Δ
            </th>
          </tr>
        </thead>
        <tbody>
          {p.rows.map((r) => {
            const g = factGroup([r.raw_rank_fact_key, r.adjusted_rank_fact_key, r.raw_fact_key, r.adjusted_fact_key]);
            const d = r.raw_rank - r.adjusted_rank;
            return [
              <tr key={r.player_id} className={r.player_id === hi ? "hi" : undefined}>
                <th scope="row">
                  {r.name}
                  {r.player_id === hi ? <span className="hi-tag">highlight</span> : null}
                </th>
                <td className="numc">
                  #{r.raw_rank}
                  <div className="val">{r.raw_value.toLocaleString("en-US")}</div>
                </td>
                <td className="numc">
                  #{r.adjusted_rank}
                  <div className="val">{r.adjusted_value.toLocaleString("en-US")}</div>
                </td>
                <td className={`numc ${d > 0 ? "up" : d < 0 ? "down" : ""}`}>
                  {d > 0 ? `▲${d}` : d < 0 ? `▼${-d}` : "="}
                </td>
              </tr>,
              <tr key={`${r.player_id}-f`} className="factrow">
                <td colSpan={4}>
                  {g.prefix ? (
                    <>
                      <span className="fk">{g.prefix}</span>
                      <span className="fcols">#{g.columns.join(" · #")}</span>
                    </>
                  ) : (
                    g.columns.map((c) => (
                      <span key={c} className="fk">
                        {c}
                      </span>
                    ))
                  )}
                </td>
              </tr>,
            ];
          })}
        </tbody>
      </table>
      <p className="mono muted">fact order: raw rank · adjusted rank · raw value · adjusted value</p>

      <h4 className="subhead">Scenes</h4>
      <ol className="scenes-list">
        {p.scenes.map((s) => (
          <li key={s.id}>
            <span className={`kind-pin scene-${s.kind}`}>{s.kind}</span>
            <span className="os">{s.on_screen}</span>
            <span className="mono muted">
              {s.id}
              {s.focus.length ? ` · focus ${s.focus.join(", ")}` : ""}
            </span>
          </li>
        ))}
      </ol>
      <dl className="facts compact">
        <dt>Attribution</dt>
        <dd>{p.attribution}</dd>
        <dt>Method</dt>
        <dd>{p.method_note}</dd>
      </dl>
    </>
  );
}

function JsonEditor({ detail }: { detail: ProjectDetail }) {
  const qc = useQueryClient();
  const initial = detail.props ? JSON.stringify(detail.props.props, null, 2) : "";
  const [text, setText] = useState(initial);
  const [parseError, setParseError] = useState<string | null>(null);
  const [result, setResult] = useState<{ version: number | null; errors: string[] } | null>(null);
  // follow new versions while the editor is untouched
  const [base, setBase] = useState(initial);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only react to new server versions
  useEffect(() => {
    if (text === base) {
      setText(initial);
      setBase(initial);
    }
  }, [initial]);

  const save = useMutation({
    mutationFn: (body: unknown) => api.setProps(detail.project.id, body),
    onSuccess: (r) => {
      setResult(r);
      if (r.version !== null) void qc.invalidateQueries({ queryKey: qk.project(detail.project.id) });
    },
  });
  const submit = () => {
    setResult(null);
    try {
      const body = JSON.parse(text) as unknown;
      setParseError(null);
      save.mutate(body);
    } catch (e) {
      setParseError(errorText(e));
    }
  };
  return (
    <div className="json-edit">
      <label className="legend" htmlFor="props-json">
        Props JSON · validated server-side (schema + every figure against its fact)
      </label>
      <textarea
        id="props-json"
        className="code"
        spellCheck={false}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={18}
        data-testid="props-json"
        placeholder='{"format": "vertical", "hook_shape": "payoff-first", ...}'
      />
      <div className="row-actions">
        <button
          type="button"
          className="key primary small"
          onClick={submit}
          disabled={save.isPending || !text.trim()}
          data-testid="save-props"
        >
          {save.isPending ? "Validating…" : "Save props"}
        </button>
        <button type="button" className="key small" onClick={() => setText(initial)} disabled={text === initial}>
          Revert
        </button>
      </div>
      <div aria-live="polite" data-testid="props-result">
        {parseError ? (
          <div className="errbox">
            <Led status="blocked" label="NOT JSON" />
            <span className="mono">{parseError}</span>
          </div>
        ) : null}
        {save.isError ? (
          <div className="errbox">
            <Led status="blocked" label="ERROR" />
            <span className="mono">{errorText(save.error)}</span>
          </div>
        ) : null}
        {result && result.errors.length ? (
          <div className="errbox">
            <Led status="blocked" label={`REJECTED · ${result.errors.length}`} />
            <ul>
              {result.errors.map((e) => (
                <li key={e} className="mono">
                  {e}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {result && result.version !== null ? (
          <div className="okbox">
            <Led status="pass" label="STORED" /> <span className="mono">as v{result.version}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
