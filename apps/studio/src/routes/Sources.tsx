/** Sources: the registry (verdicts, licences, kinds, hosts) and the tested capabilities. */
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api, qk } from "../api";
import { Jack, KindPin, Led, Screws } from "../components/glyphs";
import { ErrorState, Loading, Toggle } from "../components/ui";
import { LICENCE_META, LICENCE_RANK } from "../logic";

type Filter = "all" | "legal" | "non_commercial" | "paid" | "avoid";

export function SourcesPage() {
  const q = useQuery({ queryKey: qk.sources, queryFn: api.sources });
  const [filter, setFilter] = useState<Filter>("all");
  const sources = useMemo(
    () =>
      [...(q.data?.sources ?? [])]
        .filter((s) => filter === "all" || s.verdict === filter)
        .sort(
          (a, b) =>
            a.sport.localeCompare(b.sport) ||
            (LICENCE_RANK[a.verdict] ?? 9) - (LICENCE_RANK[b.verdict] ?? 9) ||
            a.id.localeCompare(b.id),
        ),
    [q.data, filter],
  );
  const caps = q.data?.capabilities ?? [];
  const counts = (v: string) => (q.data?.sources ?? []).filter((s) => s.verdict === v).length;

  return (
    <main id="main" className="page wrap sources-page">
      <section className="module" aria-labelledby="reg-h">
        <Screws at={["tl", "tr"]} />
        <div className="module-head">
          <h1 id="reg-h">Source registry</h1>
          <span className="tag">data/registry/sources.yaml · {q.data?.sources.length ?? "—"} sources</span>
          <span className="spacer" />
          <Toggle
            title="Verdict"
            label="Filter by verdict"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All" },
              { value: "legal", label: `Legal ${q.data ? counts("legal") : ""}` },
              { value: "non_commercial", label: `NC ${q.data ? counts("non_commercial") : ""}` },
              { value: "paid", label: `Paid ${q.data ? counts("paid") : ""}` },
              { value: "avoid", label: `Avoid ${q.data ? counts("avoid") : ""}` },
            ]}
          />
        </div>
        <p className="page-note">
          Every data request goes through the ingest clients (registry verdict, robots.txt, ≤ 50 % of the published rate
          limit, cache, contact UA). Sources with verdict <b>avoid</b> have no hosts and are never fetched.
        </p>
        {q.isError ? (
          <ErrorState error={q.error} what="Registry" />
        ) : q.isLoading ? (
          <Loading what="Reading the registry…" />
        ) : (
          <div className="table-scroll">
            <table className="dtable" data-testid="registry-table">
              <thead>
                <tr>
                  <th scope="col">Source</th>
                  <th scope="col">Sport</th>
                  <th scope="col">Verdict</th>
                  <th scope="col">Licence</th>
                  <th scope="col">Kinds</th>
                  <th scope="col">Access · hosts</th>
                  <th scope="col">Attribution</th>
                  <th scope="col">Notes</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.id} className={s.verdict === "avoid" ? "avoid-row" : undefined}>
                    <th scope="row">
                      <a
                        className={`mono src-id${s.verdict === "avoid" ? " struck" : ""}`}
                        href={s.url}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        {s.id}
                      </a>
                    </th>
                    <td>{s.sport}</td>
                    <td>
                      <Jack cls={s.verdict} />
                      <div className="muted small">{LICENCE_META[s.verdict].word}</div>
                    </td>
                    <td className="mono">{s.license}</td>
                    <td>
                      <span className="pins">
                        {s.kinds.map((k) => (
                          <KindPin key={k} kind={k} />
                        ))}
                        {(s.partial_kinds ?? []).map((k) => (
                          <KindPin key={`p-${k}`} kind={k} partial />
                        ))}
                      </span>
                    </td>
                    <td className="mono">
                      <div>{s.access}</div>
                      {s.hosts.length ? (
                        s.hosts.map((h) => <div key={h}>{h}</div>)
                      ) : (
                        <div className="muted">{s.verdict === "avoid" ? "no hosts · unreachable" : "no hosts"}</div>
                      )}
                    </td>
                    <td>{s.attribution ?? <span className="muted">none required</span>}</td>
                    <td className="notes">
                      {s.verdict_note ? <div>verdict: {s.verdict_note}</div> : null}
                      {s.notes ? <div>{s.notes}</div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="module" aria-labelledby="cap-h">
        <Screws at={["tl", "tr"]} />
        <div className="module-head">
          <h2 id="cap-h">Tested capabilities</h2>
          <span className="tag">
            meta.capabilities · {caps.length} rows · the heatmap reads these, never declarations alone
          </span>
        </div>
        {q.data && !caps.length ? (
          <div className="display empty">
            <b>No capability tests on record.</b> Run <span className="mono">just ingest &lt;source&gt;</span> and{" "}
            <span className="mono">just transform</span>; until then every heatmap cell reports "not tested".
          </div>
        ) : caps.length ? (
          <div className="table-scroll">
            <table className="dtable" data-testid="capabilities-table">
              <thead>
                <tr>
                  <th scope="col">Sport</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Source</th>
                  <th scope="col">Licence class</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="numc">
                    Coverage
                  </th>
                  <th scope="col" className="numc">
                    Rows
                  </th>
                  <th scope="col">Detail</th>
                </tr>
              </thead>
              <tbody>
                {caps.map((c) => (
                  <tr key={`${c.sport}|${c.kind}|${c.source_id}`}>
                    <td>{c.sport}</td>
                    <td>
                      <KindPin kind={c.kind} />
                    </td>
                    <th scope="row" className="mono">
                      {c.source_id}
                    </th>
                    <td>
                      <Jack cls={c.license_class} />
                    </td>
                    <td>
                      <Led status={c.status === "pass" ? "pass" : "fail"} label={c.status.toUpperCase()} />
                    </td>
                    <td className="numc mono">
                      {c.coverage_from ?? "?"}–{c.coverage_to ?? "?"}
                    </td>
                    <td className="numc mono">{c.rows.toLocaleString("en-US")}</td>
                    <td className="notes">{c.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </main>
  );
}
