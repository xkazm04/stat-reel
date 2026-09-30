/** The rights-desk ticker: counted facts only (registry, capability tests, heatmap, rundown). */
import { useHeatmap, useProjects, useSources } from "../data";
import { tickerFacts } from "../onair";

export function Ticker() {
  const hm = useHeatmap();
  const src = useSources();
  const pr = useProjects();
  const facts =
    hm.data && src.data
      ? tickerFacts({
          sources: src.data.sources,
          capabilities: src.data.capabilities,
          cells: hm.data.cells,
          usecases: hm.data.usecases.length,
          projects: pr.data ? pr.data.projects.length : null,
        })
      : null;
  return (
    <section className="ticker" aria-label="Rights desk: registry facts">
      <div className="ticker__label">Rights desk</div>
      {facts ? (
        <>
          <ul className="sr-only">
            {facts.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          <div className="ticker__track" aria-hidden="true">
            {[...facts, ...facts].map((f, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: the list is doubled for the loop
              <span key={i}>{f}</span>
            ))}
          </div>
        </>
      ) : (
        <div className="ticker__track ticker__track--still">
          <span>
            {hm.isError || src.isError ? "Rights desk offline: the API did not answer" : "Reading the registry"}
          </span>
        </div>
      )}
    </section>
  );
}
