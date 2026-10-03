/**
 * Staggered arrival (page-load discipline): a screen mounts top to bottom instead of all at once.
 * `<Defer tier={n}>` holds its children back until n steps after it mounted, on an idle slice,
 * while a same-size placeholder reserves the space (no layout shift). Nested Defers start counting
 * when their parent mounts, so a section's own children cascade after the section. `visible`
 * additionally waits until the placeholder is near the viewport (below-the-fold work is not done
 * until it is wanted); a section named by `anchor` keeps its id on the placeholder and mounts at
 * once when the URL hash points at it. A Defer with an `id` is one-shot: once shown in this session it mounts at
 * once and without the fade on a revisit (the chunk and the query cache are warm; nothing replays).
 * Reduced motion keeps the staggered mount (it spreads work) and drops the fade.
 */
import { type ReactNode, useEffect, useRef, useState } from "react";

/** One tier step; four tiers fit inside a quarter second. */
export const STAGGER_MS = 70;
/** Upper bound for any single wait, so a deep tier can never feel like a hang. */
export const MAX_DELAY_MS = 420;

export const tierDelay = (tier: number): number => Math.min(MAX_DELAY_MS, Math.max(0, Math.round(tier)) * STAGGER_MS);

const shown = new Set<string>();
/** Test hook: forget what has been shown. */
export const resetArrivals = (): void => shown.clear();

type Idle = (cb: () => void) => () => void;
const onIdle: Idle = (cb) => {
  if (typeof window === "undefined") {
    cb();
    return () => undefined;
  }
  if (window.requestIdleCallback) {
    const h = window.requestIdleCallback(cb, { timeout: 160 });
    return () => window.cancelIdleCallback(h);
  }
  const h = window.setTimeout(cb, 1);
  return () => window.clearTimeout(h);
};

export function Defer({
  tier = 0,
  id,
  visible = false,
  minHeight = 96,
  phClass = "",
  anchor,
  fallback,
  children,
}: {
  tier?: number;
  id?: string;
  /** also wait for the placeholder to come within 240 px of the viewport */
  visible?: boolean;
  /** reserved height while pending */
  minHeight?: number | string;
  /** class for the placeholder, so it takes the grid cell its content will */
  phClass?: string;
  /** the id of the section inside: the placeholder answers to it so `#anchor` links resolve before it mounts */
  anchor?: string;
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const instant = useRef(!!id && shown.has(id)).current;
  const [ready, setReady] = useState(
    () => instant || (tier <= 0 && !visible) || (!!anchor && window.location.hash === `#${anchor}`),
  );
  const ph = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (id) shown.add(id);
    if (ready) return;
    let stop: () => void = () => undefined;
    let timer = 0;
    const arm = () => {
      timer = window.setTimeout(() => {
        stop = onIdle(() => setReady(true));
      }, tierDelay(tier));
    };
    let io: IntersectionObserver | null = null;
    const el = ph.current;
    if (visible && el && typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver(
        (es) => {
          if (es.some((e) => e.isIntersecting)) {
            io?.disconnect();
            arm();
          }
        },
        { rootMargin: "240px 0px" },
      );
      io.observe(el);
    } else arm();
    return () => {
      io?.disconnect();
      window.clearTimeout(timer);
      stop();
    };
  }, [id, ready, tier, visible]);

  if (!ready)
    return (
      <div
        ref={ph}
        id={anchor}
        className={`defer-ph ${phClass}`}
        style={{ minHeight }}
        aria-hidden={anchor ? undefined : "true"}
      >
        {fallback ?? <i className="sk" />}
      </div>
    );
  return <div className={instant ? "defer" : "defer defer--in"}>{children}</div>;
}

/** A grid of skeleton rows for a list or table that has not arrived. */
export function SkeletonRows({ rows = 4, h = 44 }: { rows?: number; h?: number }) {
  return (
    <div className="sk-rows" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static decorative rows
        <i key={i} className="sk" style={{ height: h }} />
      ))}
    </div>
  );
}

/** What a lazy route shows (after a short grace, so a fast load never flashes it). */
export function PagePending() {
  return (
    <main id="main" className="page page--pending" aria-busy="true">
      <p className="label loading" role="status">
        Loading
      </p>
      <i className="sk sk--title" aria-hidden="true" />
      <SkeletonRows rows={5} h={56} />
    </main>
  );
}
