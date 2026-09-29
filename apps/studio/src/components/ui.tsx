/** Small Patchbay controls: module shell, hardware toggle, states (loading / error / empty). */
import type { ReactNode } from "react";
import { errorText } from "../api";
import { Led, Screws } from "./glyphs";

export function Module({
  title,
  tag,
  actions,
  children,
  className,
  screws = ["tl", "tr"],
  id,
  testId,
  headingLevel = 2,
}: {
  title: ReactNode;
  tag?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  screws?: ("tl" | "tr" | "bl" | "br")[];
  id?: string;
  testId?: string;
  headingLevel?: 2 | 3;
}) {
  const H = headingLevel === 2 ? "h2" : "h3";
  const hid = id ? `${id}-h` : undefined;
  return (
    <section className={`module${className ? ` ${className}` : ""}`} aria-labelledby={hid} id={id} data-testid={testId}>
      <Screws at={screws} />
      <div className="module-head">
        <H id={hid}>{title}</H>
        {tag ? <span className="tag">{tag}</span> : null}
        <span className="spacer" />
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Toggle<T extends string>({
  title,
  value,
  options,
  onChange,
  label,
  testIdPrefix,
}: {
  title?: string;
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  label: string;
  testIdPrefix?: string;
}) {
  return (
    <div className="toggle">
      {title ? <span className="toggle-title">{title}</span> : null}
      <fieldset className="toggle-body" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={o.value === value}
            onClick={() => onChange(o.value)}
            data-testid={testIdPrefix ? `${testIdPrefix}${o.value.replace(/_/g, "-")}` : undefined}
          >
            {o.label}
          </button>
        ))}
      </fieldset>
    </div>
  );
}

export function Loading({ what }: { what: string }) {
  return (
    <div className="state state-loading" role="status">
      <Led status="running" label="LOADING" />
      <span>{what}</span>
    </div>
  );
}

export function ErrorState({ error, what }: { error: unknown; what: string }) {
  return (
    <div className="state state-error" role="alert">
      <Led status="blocked" label="NO SIGNAL" />
      <div>
        <b>{what} unavailable.</b> <span className="mono">{errorText(error)}</span>
        <p className="state-hint">
          The studio reads live data from the StatReel server (127.0.0.1:8787). Start it with{" "}
          <span className="mono">pnpm --filter @statreel/server dev</span>.
        </p>
      </div>
    </div>
  );
}

export function Empty({ children, onDisplay = true }: { children: ReactNode; onDisplay?: boolean }) {
  return <div className={onDisplay ? "display empty" : "empty-plain"}>{children}</div>;
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div
      className="progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label={label}
    >
      <div className="progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}
