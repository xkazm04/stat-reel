/**
 * Heatmap, Topics view (ADR 011): one row per topic of the controlled list, column n = the n-th
 * video made for that topic, coloured by how recently it was made (fresh / recent / cooling / cold).
 * A row exists once a video or an accepted case resolves to the topic; "Show all topics" lists the
 * whole controlled list. The next ordinal is a ghost cell while a generation job is queued or
 * running. Every filled cell prints its age (never colour-only) and links to the video, or to the
 * Board case for a video without a served file. The grid is ONE tab stop (roving tabindex, the same
 * gridMove as the feasibility grid): arrows / Home / End reach every cell, linked or not, and a
 * screen-reader summary states the grid's shape.
 */
import { RECENCY_BUCKETS } from "@statreel/schemas";
import { Link } from "@tanstack/react-router";
import { type FocusEvent, type KeyboardEvent, useRef, useState } from "react";
import { Defer } from "../components/arrive";
import { Card } from "../components/Card";
import { ViewSwitch } from "../components/HeatmapViews";
import { Failure, Loading } from "../components/ui";
import { useHeatmapTopics } from "../data";
import { relTime } from "../logic";
import {
  ageLabel,
  cellAria,
  cellTarget,
  clampPos,
  emptyCellLabel,
  type GridPos,
  gridColCount,
  gridWidth,
  newTabLabel,
  nextPos,
  sortTopics,
  type TopicRow,
  type TopicVideoCell,
  tabIndexFor,
  topicSummary,
  visibleColumns,
} from "../topicHeatmap";

export function HeatmapTopics() {
  const [all, setAll] = useState(false);
  const q = useHeatmapTopics(all);
  const data = q.data;
  const rows = data ? sortTopics(data.topics) : [];
  const cols = visibleColumns(gridWidth(data?.max_videos ?? 0, rows));
  const n = cols.last - cols.first + 1;
  const ordinals = Array.from({ length: n }, (_, i) => cols.first + i);
  const totalVideos = rows.reduce((a, t) => a + t.videos.length, 0);
  const grid = useRef<HTMLDivElement>(null);

  // roving position over every cell; kept inside the grid when rows/columns shrink
  const [pos, setPos] = useState<GridPos>({ r: 0, c: 0 });
  const cur = clampPos(pos, rows.length, n);

  const onFocus = (e: FocusEvent<HTMLDivElement>) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-r]");
    if (el) setPos({ r: Number(el.dataset.r), c: Number(el.dataset.c) });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-r]");
    if (!el || e.ctrlKey || e.metaKey || e.altKey) return;
    const next = nextPos({ r: Number(el.dataset.r), c: Number(el.dataset.c) }, e.key, rows.length, n);
    if (!next) return;
    e.preventDefault();
    setPos(next);
    grid.current?.querySelector<HTMLElement>(`[data-r="${next.r}"][data-c="${next.c}"]`)?.focus();
  };

  return (
    <main id="main" className="hm hm--topics">
      <div className="hm-layer1 tp">
        <header className="hm-head">
          <div className="hm-title">
            <p className="eyebrow">Heatmap · topics</p>
            <h1>What we have made</h1>
          </div>
          <div className="hm-ctl">
            <ViewSwitch view="topics" />
          </div>
        </header>

        {q.isError ? (
          <Card className="tp-card">
            <Failure
              error={q.error}
              what="The topic heatmap"
              onRetry={() => void q.refetch()}
              retrying={q.isFetching}
            />
          </Card>
        ) : q.isLoading || !data ? (
          <Card className="tp-card">
            <Loading what="the topic heatmap" />
          </Card>
        ) : !rows.length ? (
          // the empty copy names "Show all topics", so the toggle stays on screen with no rows
          <Card className="tp-card" title="Videos per topic" actions={<ShowAll all={all} setAll={setAll} />}>
            <div className="empty" data-testid="topics-empty">
              <b>No videos yet</b>A row appears for a topic once a case in it is accepted on the Board; cells fill as
              videos finish.{" "}
              <Link to="/board" search={{ tab: "cases" } as never}>
                Open the Board cases
              </Link>
              , or see the{" "}
              <Link to="/heatmap" search={{ view: "feasibility" }}>
                feasibility grid
              </Link>
              . "Show all topics" lists the whole controlled list.
            </div>
          </Card>
        ) : (
          <Defer tier={1} id="topics:grid" phClass="card tp-card" minHeight={320}>
            <Card
              className="tp-card"
              title="Videos per topic"
              tag={`${rows.length} topic${rows.length === 1 ? "" : "s"} · ${totalVideos} video${totalVideos === 1 ? "" : "s"}`}
              pad="none"
              actions={<ShowAll all={all} setAll={setAll} />}
              footer={
                <>
                  <span>
                    <kbd>Arrows</kbd> move between videos
                  </span>
                  <span>Column n is the n-th video made for the topic, oldest first.</span>
                  <span>{data.generated_at ? `As of ${relTime(data.generated_at)}` : ""}</span>
                </>
              }
            >
              <div className="card__toolbar">
                <ul className="tp-legend" aria-label="Colour scale: how long ago a video was made">
                  {RECENCY_BUCKETS.map((b) => (
                    <li key={b.id} data-bucket={b.id}>
                      <i aria-hidden="true" />
                      <span>{b.label}</span>
                    </li>
                  ))}
                  <li data-bucket="pending">
                    <i aria-hidden="true" />
                    <span>queued / rendering</span>
                  </li>
                </ul>
              </div>
              <div className="tp-wrap">
                {totalVideos === 0 ? (
                  <p className="tp-note" data-testid="topics-no-videos">
                    Topics are listed, but no video has finished yet. Cells fill as videos finish.
                  </p>
                ) : null}
                <p className="sr-only" id="tp-summary" data-testid="topics-summary">
                  {topicSummary(rows)}. Arrow keys move between cells; Enter opens a video.
                </p>
                <div
                  ref={grid}
                  className="tp-grid"
                  role="grid"
                  aria-label="Videos per topic, by order of creation"
                  aria-rowcount={rows.length + 1}
                  aria-colcount={gridColCount(n, cols.earlier)}
                  aria-describedby="tp-summary"
                  onKeyDown={onKeyDown}
                  onFocus={onFocus}
                  style={{ ["--cols" as string]: n + (cols.earlier ? 1 : 0) }}
                >
                  <div className="tp-row tp-row--head" role="row">
                    <div className="tp-corner" role="columnheader">
                      Topic
                    </div>
                    {cols.earlier ? (
                      <div className="tp-colh tp-colh--earlier num" role="columnheader">
                        +{cols.earlier} earlier
                      </div>
                    ) : null}
                    {ordinals.map((o) => (
                      <div key={o} className="tp-colh num" role="columnheader">
                        {o}
                      </div>
                    ))}
                  </div>
                  {rows.map((t, ri) => (
                    <TopicLine key={t.key} t={t} ri={ri} cur={cur} hasEarlier={cols.earlier > 0} ordinals={ordinals} />
                  ))}
                </div>
              </div>
            </Card>
          </Defer>
        )}
      </div>
    </main>
  );
}

/** "Show all topics": the whole controlled list, rows without a video included. */
function ShowAll({ all, setAll }: { all: boolean; setAll: (v: boolean) => void }) {
  return (
    <label className="tp-toggle">
      <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} data-testid="topics-show-all" />
      Show all topics
    </label>
  );
}

function TopicLine({
  t,
  ri,
  cur,
  hasEarlier,
  ordinals,
}: {
  t: TopicRow;
  ri: number;
  cur: GridPos;
  hasEarlier: boolean;
  ordinals: number[];
}) {
  const byN = new Map(t.videos.map((v) => [v.n, v]));
  const next = t.videos.length + 1;
  const pendingLabel = t.pending.running ? "rendering" : t.pending.queued > 0 ? "queued" : null;
  const last = t.videos.at(-1);
  const sub = last
    ? ` · last ${ageLabel(last.age_days)}`
    : t.accepted_cases
      ? ` · ${t.accepted_cases} accepted case${t.accepted_cases === 1 ? "" : "s"}`
      : "";
  return (
    <div className="tp-row" role="row" data-testid={`topic-row-${t.key}`}>
      <div className="tp-rowh" role="rowheader">
        <b>{t.label}</b>
        <small className="num">
          {t.videos.length} video{t.videos.length === 1 ? "" : "s"}
          {sub}
        </small>
      </div>
      {hasEarlier ? <div className="tp-cell tp-cell--earlier" aria-hidden="true" /> : null}
      {ordinals.map((o, ci) => {
        const v = byN.get(o);
        if (v)
          return (
            <VideoCell
              key={o}
              topic={t.label}
              topicKey={t.key}
              v={v}
              total={t.videos.length}
              ri={ri}
              ci={ci}
              tab={tabIndexFor(cur, ri, ci)}
            />
          );
        if (o === next && pendingLabel)
          return (
            <div
              key={o}
              className="tp-cell tp-cell--pending"
              role="gridcell"
              data-r={ri}
              data-c={ci}
              tabIndex={tabIndexFor(cur, ri, ci)}
              aria-label={emptyCellLabel(t.label, o, pendingLabel, false)}
              data-testid={`topic-cell-${t.key}-${o}`}
              data-bucket="pending"
            >
              <span className="num">{pendingLabel}</span>
            </div>
          );
        const none = o === 1 && !t.videos.length;
        return (
          <div
            key={o}
            className="tp-cell tp-cell--empty"
            role="gridcell"
            data-r={ri}
            data-c={ci}
            tabIndex={tabIndexFor(cur, ri, ci)}
            aria-label={emptyCellLabel(t.label, o, null, none)}
          >
            {none ? <span className="tp-none">none yet</span> : null}
          </div>
        );
      })}
    </div>
  );
}

function VideoCell({
  topic,
  topicKey,
  v,
  total,
  ri,
  ci,
  tab,
}: {
  topic: string;
  topicKey: string;
  v: TopicVideoCell;
  total: number;
  ri: number;
  ci: number;
  tab: 0 | -1;
}) {
  const common = {
    role: "gridcell" as const,
    className: "tp-cell tp-cell--video",
    "data-bucket": v.bucket,
    "data-r": ri,
    "data-c": ci,
    "data-testid": `topic-cell-${topicKey}-${v.n}`,
    "aria-label": cellAria(topic, v, total),
    tabIndex: tab,
    title: v.title,
  };
  const label = <span className="num">{ageLabel(v.age_days)}</span>;
  // link order (cellTarget): served file, then Studio project, then Board case
  const target = cellTarget(v);
  if (target.kind === "file")
    return (
      <a {...common} aria-label={newTabLabel(common["aria-label"])} href={target.url} target="_blank" rel="noreferrer">
        {label}
      </a>
    );
  if (target.kind === "project")
    return (
      <Link {...common} to="/studio/$projectId" params={{ projectId: target.projectId }}>
        {label}
      </Link>
    );
  if (target.kind === "case")
    return (
      <Link {...common} to="/board" search={{ tab: "cases" } as never}>
        {label}
      </Link>
    );
  return <span {...common}>{label}</span>;
}
