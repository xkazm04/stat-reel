/** Broadcast-style global navigation: the mark, six channels, and the live tally of the bus. */
import { Link, useRouterState } from "@tanstack/react-router";
import { useSources } from "../data";
import { useConnectionState } from "../events";
import { Mark } from "./glyphs";

const LINKS = [
  { to: "/", label: "Front", match: (p: string) => p === "/" },
  { to: "/heatmap", label: "Heatmap", match: (p: string) => p.startsWith("/heatmap") },
  { to: "/projects", label: "Rundown", match: (p: string) => p.startsWith("/projects") },
  { to: "/studio", label: "Studio", match: (p: string) => p.startsWith("/studio") },
  { to: "/metrics", label: "Metrics", match: (p: string) => p.startsWith("/metrics") },
  { to: "/sources", label: "Sources", match: (p: string) => p.startsWith("/sources") },
] as const;

export function Nav() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const conn = useConnectionState();
  const sources = useSources();
  const n = sources.data?.sources.length;
  return (
    <header className="nav">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <Link to="/" className="logo" aria-label="StatReel, front page">
        <Mark />
        <span className="logo__word">
          STAT<b>REEL</b>
        </span>
      </Link>
      <nav className="nav__links" aria-label="Primary">
        {LINKS.map((l) => (
          <Link key={l.to} to={l.to} aria-current={l.match(path) ? "page" : undefined}>
            {l.label}
          </Link>
        ))}
      </nav>
      <div className="nav__right">
        <span className={`nav__tx nav__tx--${conn}`} role="status">
          <i className={conn === "open" ? "tally" : "tally tally--off"} aria-hidden="true" />
          {conn === "open" ? "Live bus" : conn === "connecting" ? "Connecting bus" : "Bus offline"}
          {typeof n === "number" ? ` · ${n} sources on the rights desk` : ""}
        </span>
      </div>
    </header>
  );
}
