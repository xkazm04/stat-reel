/**
 * Global navigation: the wordmark, eight screens and the live bus tally. Below 1100 px the links
 * and the tally collapse into a menu so the bar never scrolls sideways (390 px included).
 */
import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";
import { useSources } from "../data";
import { useConnectionState } from "../events";
import { Wordmark } from "./Wordmark";

export const NAV_LINKS = [
  { to: "/", label: "Front", match: (p: string) => p === "/" },
  { to: "/heatmap", label: "Heatmap", match: (p: string) => p.startsWith("/heatmap") },
  { to: "/projects", label: "Rundown", match: (p: string) => p.startsWith("/projects") },
  { to: "/studio", label: "Studio", match: (p: string) => p.startsWith("/studio") },
  { to: "/calendar", label: "Calendar", match: (p: string) => p.startsWith("/calendar") },
  { to: "/board", label: "Board", match: (p: string) => p.startsWith("/board") },
  { to: "/metrics", label: "Metrics", match: (p: string) => p.startsWith("/metrics") },
  { to: "/sources", label: "Sources", match: (p: string) => p.startsWith("/sources") },
] as const;

export function Nav() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const conn = useConnectionState();
  const sources = useSources();
  const n = sources.data?.sources.length;
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const drawerId = useId();

  // a route change closes the menu
  // biome-ignore lint/correctness/useExhaustiveDependencies: close on every path change
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    document.documentElement.classList.add("nav-open");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.classList.remove("nav-open");
    };
  }, [open]);

  return (
    <header className="nav">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <Link to="/" className="logo" aria-label="StatReel, front page">
        <Wordmark />
      </Link>
      <button
        type="button"
        ref={btn}
        className="nav__menu-btn"
        aria-expanded={open}
        aria-controls={drawerId}
        onClick={() => setOpen((o) => !o)}
      >
        <i aria-hidden="true" />
        Menu
      </button>
      <div className={`nav__drawer${open ? " is-open" : ""}`} id={drawerId}>
        <nav className="nav__links" aria-label="Primary">
          {NAV_LINKS.map((l) => (
            <Link key={l.to} to={l.to} aria-current={l.match(path) ? "page" : undefined}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="nav__right">
          <span className={`nav__tx nav__tx--${conn}`} role="status">
            <i className={conn === "open" ? "tally" : "tally tally--off"} aria-hidden="true" />
            {conn === "open" ? "Live bus" : conn === "connecting" ? "Connecting bus" : "Bus offline"}
            {typeof n === "number" ? <span className="nav__tx-count">{` · ${n} sources on the registry`}</span> : null}
          </span>
        </div>
      </div>
    </header>
  );
}
