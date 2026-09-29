/** The top rail of the rack: brand, primary keys, live link lamp. */
import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { api, qk } from "../api";
import { useConnectionState } from "../events";
import { lastProjectId } from "../prefs";
import { Led, LogoMark } from "./glyphs";

export function Rail() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const link = useConnectionState();
  const sources = useQuery({ queryKey: qk.sources, queryFn: api.sources, staleTime: 60_000 });
  const projects = useQuery({ queryKey: qk.projects, queryFn: api.projects, staleTime: 30_000 });
  const known = projects.data?.projects ?? [];
  const remembered = lastProjectId();
  const last = remembered && (!projects.data || known.some((p) => p.id === remembered)) ? remembered : known[0]?.id;
  const items = [
    { to: "/", idx: "01", label: "Front panel", short: "Panel", active: path === "/" },
    { to: "/heatmap", idx: "02", label: "Heatmap", short: "Heatmap", active: path.startsWith("/heatmap") },
    { to: "/projects", idx: "03", label: "Projects", short: "Projects", active: path.startsWith("/projects") },
    {
      to: last ? `/studio/${last}` : null,
      idx: "04",
      label: "Studio",
      short: "Studio",
      active: path.startsWith("/studio"),
    },
    { to: "/sources", idx: "05", label: "Sources", short: "Sources", active: path.startsWith("/sources") },
  ];
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="rail">
        <Link to="/" className="brand" aria-label="StatReel front panel">
          <LogoMark />
          <span className="brand-word">
            STAT<b>R</b>EEL
          </span>
        </Link>
        <span className="brand-sub">licence-aware sports data → video</span>
        <nav aria-label="Primary">
          {items.map((it) => {
            const inner = (
              <>
                <span className="lamp" aria-hidden="true" />
                <span className="idx">{it.idx}</span>
                <span className="rail-long">{it.label}</span>
                <span className="rail-short">{it.short}</span>
              </>
            );
            return it.to ? (
              <Link key={it.idx} to={it.to} className="rail-key" aria-current={it.active ? "page" : undefined}>
                {inner}
              </Link>
            ) : (
              <button
                key={it.idx}
                type="button"
                className="rail-key"
                disabled
                aria-label="Studio: no project yet, create one from the heatmap"
              >
                {inner}
              </button>
            );
          })}
        </nav>
        <div className="rail-right">
          <span className="rail-status" aria-live="polite">
            {link === "open" ? (
              <Led status="go" label="LINKED" />
            ) : link === "connecting" ? (
              <Led status="running" label="LINKING" />
            ) : (
              <Led status="blocked" label="NO LINK" />
            )}
            <span>LOCAL · {sources.data ? `${sources.data.sources.length} SOURCES IN REGISTRY` : "REGISTRY —"}</span>
          </span>
        </div>
      </header>
    </>
  );
}
