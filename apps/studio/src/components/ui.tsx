/** Small shared pieces: empty states, errors, sparkline, section heads, reduced-motion, wipe. */
import {
  type CSSProperties,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { errorText } from "../api";
import { sparkPoints } from "../display";

/** An honest, labelled empty state. */
export function Empty({
  title,
  children,
  className = "",
}: {
  title: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`empty ${className}`}>
      <b>{title}</b>
      {children}
    </div>
  );
}

export function Failure({ error, what }: { error: unknown; what: string }) {
  return (
    <div className="failure" role="alert">
      <b>{what} did not load</b>
      <span className="mono">{errorText(error)}</span>
      <span>Is the API running on 127.0.0.1:8787? (`pnpm dev` starts both.)</span>
    </div>
  );
}

export const Loading = ({ what }: { what: string }) => (
  <p className="loading label" aria-live="polite">
    Loading {what}
  </p>
);

export function SecH({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <h3 className="sec-h">
      <span>{children}</span>
      {right ? <span>{right}</span> : null}
    </h3>
  );
}

/** Line sparkline; renders a labelled dash when there is no number at all. */
export function Sparkline({
  values,
  w = 120,
  h = 28,
  label,
  className = "spark",
}: {
  values: (number | null)[];
  w?: number;
  h?: number;
  label: string;
  className?: string;
}) {
  const pts = sparkPoints(values, w, h);
  if (!pts)
    return (
      <span className="spark-none" role="img" aria-label={`${label}: no data`}>
        —
      </span>
    );
  return (
    <svg className={className} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      {pts
        .split(" ")
        .slice(-1)
        .map((p) => {
          const [x, y] = p.split(",");
          return <circle key={p} cx={x} cy={y} r="2.6" fill="currentColor" />;
        })}
    </svg>
  );
}

export function useReducedMotion(): boolean {
  const q = "(prefers-reduced-motion: reduce)";
  const [r, setR] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(q).matches);
  useEffect(() => {
    const m = window.matchMedia?.(q);
    if (!m) return;
    const on = () => setR(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return r;
}

// ------------------------------------------------------------------ parallelogram wipe

type WipeFn = (color: string, then: () => void) => void;
const WipeCtx = createContext<WipeFn>((_c, then) => then());

/** One fixed parallelogram that crosses the screen between levels; reduced motion skips it. */
export function WipeProvider({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const run = useCallback<WipeFn>(
    (color, then) => {
      const el = ref.current;
      if (reduced || !el) {
        then();
        return;
      }
      el.style.setProperty("--art", color);
      el.classList.remove("run");
      void el.offsetWidth;
      el.classList.add("run");
      window.setTimeout(then, 340);
    },
    [reduced],
  );
  return (
    <WipeCtx.Provider value={run}>
      {children}
      <div
        className="wipe"
        ref={ref}
        aria-hidden="true"
        onAnimationEnd={(e) => e.currentTarget.classList.remove("run")}
      />
    </WipeCtx.Provider>
  );
}

export const useWipe = (): WipeFn => useContext(WipeCtx);

export const artStyle = (color: string): CSSProperties => ({ ["--art" as string]: color });
