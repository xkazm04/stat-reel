/**
 * "On the line today": the work the owner actually has in hand (accepted cases per topic, queued and
 * running generation, accepted / pending Board items, the video ledger), each count linked to where
 * they act. `way` is a row of the Front's ways in (Photo Finish ADR 009); `panel` sits in the
 * Rundown's empty state. Every figure is counted in frontpf.ts; loading, error and empty are labelled.
 */
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { type LineItem, lineIsQuiet, lineItems, loadCause, videosLine } from "../frontpf";
import { boardQuery, lineTopicsQuery, type OnTheLineState, useOnTheLine } from "../workQuery";
import { Arrow } from "./glyphs";
import { RetryButton } from "./RetryButton";

function Counted({ item }: { item: LineItem }) {
  const body = (
    <>
      <b className="num">{item.n}</b> {item.text}
      {item.detail ? <span className="otl__detail"> ({item.detail})</span> : null}
    </>
  );
  if (item.to === "topics")
    return (
      <Link className="otl__link" to="/heatmap" search={{ view: "topics" }}>
        {body}
      </Link>
    );
  if (item.to === "board-accepted")
    return (
      <Link className="otl__link" to="/board" search={{ st: "accepted" }}>
        {body}
      </Link>
    );
  return (
    <Link className="otl__link" to="/board" search={{}}>
      {body}
    </Link>
  );
}

function Body({ state }: { state: OnTheLineState }) {
  // Retry re-runs both sources' queries (the topic heatmap and the Board); no polling, only on click
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const retry = () => {
    setBusy(true);
    void Promise.allSettled([
      qc.refetchQueries({ queryKey: lineTopicsQuery.queryKey }),
      qc.refetchQueries({ queryKey: boardQuery.queryKey }),
    ]).finally(() => setBusy(false));
  };
  if (state.status === "loading") return <span role="status">Reading what is on the line.</span>;
  if (state.status === "error")
    return (
      <span role="alert">
        {state.what} did not load ({loadCause(state.error)}), so there is nothing to count.{" "}
        <RetryButton onRetry={retry} busy={busy} />
      </span>
    );
  const { line, partial } = state;
  return (
    <>
      {partial ? (
        <span className="otl__warn" role="alert">
          The {partial} did not answer; its counts are missing. <RetryButton onRetry={retry} busy={busy} />{" "}
        </span>
      ) : null}
      {lineIsQuiet(line) && !partial ? (
        <span>
          Nothing accepted, queued or waiting yet.{" "}
          <Link className="otl__link" to="/board" search={{}}>
            Review the Board
          </Link>
          .{" "}
        </span>
      ) : (
        <ul className="otl__list">
          {lineItems(line).map((i) => (
            <li key={i.id}>
              <Counted item={i} />
            </li>
          ))}
        </ul>
      )}
      <span className="otl__ledger">{videosLine(line)}.</span>
    </>
  );
}

export function OnTheLine({ variant, style }: { variant: "way" | "panel"; style?: React.CSSProperties }) {
  const state = useOnTheLine();
  if (variant === "way")
    return (
      <div className="pf-way pf-way--line" style={style}>
        <span className="pf-way__no num">04</span>
        <span className="pf-way__label">On the line today</span>
        <span className="pf-way__detail">
          <span className="otl">
            <Body state={state} />
          </span>
          <Arrow />
        </span>
      </div>
    );
  return (
    <section className="otl otl--panel" aria-label="On the line today">
      <p className="eyebrow">On the line today</p>
      <Body state={state} />
    </section>
  );
}
