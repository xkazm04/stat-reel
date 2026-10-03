/**
 * 07 Sources: the registry (verdict, licence, kinds, hosts, attribution, notes; avoid sources are
 * struck "never fetched") and the tested capabilities (meta.capabilities) from GET /api/sources.
 */
import type { LicenseClass, Source } from "@statreel/schemas";
import { useState } from "react";
import { Defer } from "../components/arrive";
import { LicChip, TestChip } from "../components/glyphs";
import { Empty, Failure, Loading } from "../components/ui";
import { useSources } from "../data";
import { SPORTS } from "../logic";
import { kindLong, LICENCE_WORD, pad2, verdictCounts } from "../display";

type Extra = Source & {
  terms_checked_at?: string;
  terms_url?: string;
  coverage?: { from?: number; to?: number | string } | null;
};

export function SourcesPage() {
  const src = useSources();
  const [sport, setSport] = useState<string>("all");
  const sources = (src.data?.sources ?? []) as Extra[];
  const caps = src.data?.capabilities ?? [];
  const shown = sources.filter((s) => sport === "all" || s.sport === sport || s.sport === "all");
  const v = verdictCounts(sources);
  return (
    <main id="main" className="page sources-page">
      <header className="page__head">
        <div>
          <p className="eyebrow">
            <i />
            Sources · the rights desk
          </p>
          <h1 className="page__title display">What may be fetched, and what was tested</h1>
          <p className="page__sub">
            data/registry/sources.yaml is the single source of truth; ingestion refuses any host not listed.
          </p>
        </div>
        <dl className="src-counts">
          {(["legal", "non_commercial", "paid", "avoid"] as LicenseClass[]).map((k) => (
            <div key={k}>
              <dt className="num" style={{ color: `var(--licence-${k.replace("_", "-")})` }}>
                {pad2(v[k])}
              </dt>
              <dd>
                <LicChip cls={k} />
              </dd>
            </div>
          ))}
        </dl>
      </header>

      {src.isError ? (
        <Failure error={src.error} what="The registry" />
      ) : src.isLoading ? (
        <Loading what="the registry" />
      ) : (
        <>
          <div className="page__tools page__tools--row">
            <div className="seg" role="group" aria-label="Sport">
              {["all", ...SPORTS].map((s) => (
                <button type="button" key={s} aria-pressed={sport === s} onClick={() => setSport(s)}>
                  {s === "all" ? "All sports" : s}
                </button>
              ))}
            </div>
          </div>
          <h2 className="sec-h sec-h--page">
            <span>Registry · {shown.length} sources</span>
          </h2>
          <Defer tier={1} id="sources:registry" phClass="table-wrap" minHeight={260}>
            <div className="table-wrap">
              <table className="tbl tbl--sources">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Verdict</th>
                    <th>Licence</th>
                    <th>Kinds</th>
                    <th>Access · hosts</th>
                    <th>Attribution</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((s) => (
                    <tr key={s.id} className={s.verdict === "avoid" ? "is-avoid" : ""}>
                      <td>
                        {s.verdict === "avoid" ? <s className="mono">{s.id}</s> : <b className="mono">{s.id}</b>}
                        <span className="tbl__sub">{s.sport === "all" ? "all sports" : s.sport}</span>
                      </td>
                      <td>
                        <LicChip cls={s.verdict} />
                        {s.verdict === "avoid" ? <span className="tbl__sub never-tag">never fetched</span> : null}
                      </td>
                      <td>
                        {s.license}
                        {s.verdict_note ? <span className="tbl__sub">{s.verdict_note}</span> : null}
                        {s.terms_checked_at ? (
                          <span className="tbl__sub">terms checked {s.terms_checked_at}</span>
                        ) : null}
                      </td>
                      <td>
                        {s.kinds.length ? s.kinds.map((k) => kindLong(k)).join(", ") : "—"}
                        {s.partial_kinds.length ? (
                          <span className="tbl__sub">
                            partial: {s.partial_kinds.map((k) => kindLong(k)).join(", ")}
                          </span>
                        ) : null}
                      </td>
                      <td>
                        {s.access.replace("_", " ")}
                        <span className="tbl__sub mono">
                          {s.hosts.length
                            ? s.hosts.join(", ")
                            : s.verdict === "avoid"
                              ? "no hosts: unreachable in code"
                              : "no hosts"}
                        </span>
                      </td>
                      <td>{s.attribution ?? "—"}</td>
                      <td className="tbl__note">{s.notes ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Defer>

          <Defer tier={2} id="sources:caps" visible minHeight={200}>
            <h2 className="sec-h sec-h--page">
              <span>Tested capabilities · {caps.length}</span>
              <span>{caps.filter((c) => c.status === "pass").length} pass</span>
            </h2>
            {caps.length ? (
              <div className="table-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Sport</th>
                      <th>Kind</th>
                      <th>Source</th>
                      <th>Licence class</th>
                      <th>Status</th>
                      <th>Coverage</th>
                      <th className="num">Rows</th>
                      <th>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {caps
                      .filter((c) => sport === "all" || c.sport === sport)
                      .map((c) => (
                        <tr key={`${c.sport}|${c.kind}|${c.source_id}`}>
                          <td>{c.sport}</td>
                          <td>{kindLong(c.kind)}</td>
                          <td className="mono">{c.source_id}</td>
                          <td>
                            <LicChip cls={c.license_class} />
                          </td>
                          <td>
                            <TestChip status={c.status} />
                          </td>
                          <td className="num">
                            {c.coverage_from ? `${c.coverage_from}–${c.coverage_to ?? "now"}` : "—"}
                          </td>
                          <td className="num">{c.rows.toLocaleString("en-US")}</td>
                          <td className="tbl__note">{c.detail}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="No capability tested yet">
                Run <span className="mono">just transform</span>: until a capability passes, every cell on the rights
                grid says "not tested" and stays Blocked.
              </Empty>
            )}
          </Defer>
          <p className="page__foot">
            Licence classes:{" "}
            {Object.entries(LICENCE_WORD)
              .map(([k, w]) => `${w} (${k})`)
              .join(" · ")}
            . Adding a source not in the registry needs the owner.
          </p>
        </>
      )}
    </main>
  );
}
