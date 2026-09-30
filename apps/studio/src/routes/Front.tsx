/**
 * 01 Front: the floodlit front page. Proposition, fast lane (heatmap with live counts, studio,
 * resume), a tilted programme monitor playing the real EraAdjustedSlope with the newest project's
 * props, the reel of formats (each opens a scene, then a per-sport rights sheet) and the rights
 * desk ticker. Every figure comes from the API; missing data is a labelled slate.
 */
import type { PlayerRef } from "@remotion/player";
import type { CellStatus, EraAdjustedProps, HeatmapCell, Mode, Source, Sport, UseCase } from "@statreel/schemas";
import { useMutation, useQueries } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errorText, type ProjectDetail, type ProjectWithJobs, qk } from "../api";
import { useCreateProject } from "../components/createProject";
import { Arrow, Field, FormatIcon, LicChip, StatusChip } from "../components/glyphs";
import { Ident, identVar } from "../components/idents";
import { type PlayerMeta, Programme, Slate } from "../components/Programme";
import { Ticker } from "../components/Ticker";
import { artStyle, useReducedMotion, useWipe } from "../components/ui";
import { latestRender, renderPolicy, useHeatmap, useManifest, useProjects, useSources } from "../data";
import { allowedIn, cellOf, countStatuses, MODE_LABEL, SPORTS, STAGE_LABEL } from "../logic";
import {
  biggestMovers,
  fmtValue,
  formatLabel,
  kindLong,
  neverFetchedFor,
  pad2,
  rankSteps,
  resumeCandidate,
  STATUS_AIR,
  splitName,
  verdictCounts,
} from "../onair";
import type { FrontSearch } from "../router";

// ------------------------------------------------------------------ programme source

/** Newest project that has props (details of the five newest projects are read). */
function useProgramme(projects: ProjectWithJobs[] | undefined) {
  const newest = useMemo(
    () => [...(projects ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5),
    [projects],
  );
  const details = useQueries({
    queries: newest.map((p) => ({ queryKey: qk.project(p.id), queryFn: () => api.project(p.id) })),
  });
  const loading = details.some((d) => d.isLoading);
  const found = details.map((d) => d.data).find((d): d is ProjectDetail => !!d?.props);
  return { detail: found ?? null, loading: !!projects && loading };
}

// ------------------------------------------------------------------ dust

function Dust({ on }: { on: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const x = c?.getContext("2d");
    if (!c || !x) return;
    // dust is floodlight mixed into chalk: both read from the tokens
    const css = getComputedStyle(document.documentElement);
    const hex = (v: string) => {
      const m = /^#?([0-9a-f]{6})$/i.exec(v.trim());
      const n = m ? Number.parseInt(m[1] as string, 16) : 0xc8d7ff;
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    const a = hex(css.getPropertyValue("--color-floodlight"));
    const b = hex(css.getPropertyValue("--color-text"));
    const rgb = a.map((v, i) => Math.round(v * 0.3 + (b[i] ?? 255) * 0.7)).join(",");
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let w = 0;
    let h = 0;
    const size = () => {
      w = c.clientWidth;
      h = c.clientHeight;
      c.width = w * dpr;
      c.height = h * dpr;
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();
    window.addEventListener("resize", size);
    const P = Array.from({ length: 60 }, (_, i) => {
      const r = (n: number) => (((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1) + 1) % 1;
      return { x: r(1), y: r(2), r: 0.6 + r(3) * 2.2, s: 0.004 + r(4) * 0.012, a: 0.08 + r(5) * 0.3, p: r(6) * 6.28 };
    });
    let raf = 0;
    const draw = (now: number) => {
      x.clearRect(0, 0, w, h);
      const tt = now / 1000;
      for (const p of P) {
        const px = (p.x + Math.sin(tt * 0.12 + p.p) * 0.015) * w;
        const py = ((((p.y - tt * p.s) % 1) + 1) % 1) * h;
        const g = x.createRadialGradient(px, py, 0, px, py, p.r * 4);
        g.addColorStop(0, `rgba(${rgb},${p.a})`);
        g.addColorStop(1, `rgba(${rgb},0)`);
        x.fillStyle = g;
        x.beginPath();
        x.arc(px, py, p.r * 4, 0, 6.283);
        x.fill();
      }
      if (on) raf = requestAnimationFrame(draw);
    };
    draw(0);
    if (on) raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", size);
    };
  }, [on]);
  return <canvas id="dust" ref={ref} />;
}

// ------------------------------------------------------------------ lower-third plate

type Row = EraAdjustedProps["rows"][number];

function Plate({
  rows,
  rawLabel,
  adjLabel,
  reduced,
  onGhost,
}: {
  rows: Row[];
  rawLabel: string;
  adjLabel: string;
  reduced: boolean;
  onGhost: (s: string) => void;
}) {
  const movers = useMemo(() => biggestMovers(rows, 6), [rows]);
  const [i, setI] = useState(0);
  const [shown, setShown] = useState<number | null>(null);
  const d = movers[i % Math.max(1, movers.length)];
  useEffect(() => {
    if (reduced || movers.length < 2) return;
    const iv = window.setInterval(() => setI((n) => n + 1), 3600);
    return () => window.clearInterval(iv);
  }, [reduced, movers.length]);
  useEffect(() => {
    if (!d) return;
    onGhost(fmtValue(d.adjusted_value));
    if (reduced) {
      setShown(d.adjusted_rank);
      return;
    }
    const steps = rankSteps(d.raw_rank, d.adjusted_rank);
    const every = Math.max(24, Math.min(70, 1400 / steps.length));
    let k = 0;
    setShown(steps[0] ?? d.adjusted_rank);
    const iv = window.setInterval(() => {
      k++;
      if (k >= steps.length) {
        window.clearInterval(iv);
        return;
      }
      setShown(steps[k] ?? d.adjusted_rank);
    }, every);
    return () => window.clearInterval(iv);
  }, [d, reduced, onGhost]);
  if (!d) return null;
  const down = d.adjusted_rank > d.raw_rank;
  return (
    <div className="plate" aria-live="off">
      <div className="plate__k">
        Raw rank <Arrow /> era-adjusted rank
      </div>
      <div className="plate__name">{d.name}</div>
      <div className={`plate__nums num${down ? " down" : ""}`}>
        <span className="from">{pad2(d.raw_rank)}</span>
        <Arrow />
        <span className="to">{pad2(shown ?? d.adjusted_rank)}</span>
      </div>
      <div className="plate__pct">
        <b>{fmtValue(d.adjusted_value)}</b> {adjLabel.toLowerCase()}
        <span className="plate__raw">
          raw: {fmtValue(d.raw_value)} {rawLabel.toLowerCase()}
        </span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ page

export function FrontPage() {
  const search = useSearch({ from: "/" }) as FrontSearch;
  const navigate = useNavigate({ from: "/" });
  const reduced = useReducedMotion();
  const wipe = useWipe();
  const hm = useHeatmap();
  const src = useSources();
  const pr = useProjects();
  const programme = useProgramme(pr.data?.projects);
  const detail = programme.detail;
  const props = detail?.props?.props ?? null;
  const render = latestRender(detail);
  const policy = renderPolicy(render);
  const manifest = useManifest(render);

  const [intro, setIntro] = useState(!reduced);
  useEffect(() => {
    if (!intro) return;
    const done = () => setIntro(false);
    const t = window.setTimeout(done, 2400);
    window.addEventListener("keydown", done, { once: true });
    window.addEventListener("pointerdown", done, { once: true });
    window.addEventListener("wheel", done, { once: true, passive: true });
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", done);
      window.removeEventListener("pointerdown", done);
      window.removeEventListener("wheel", done);
    };
  }, [intro]);

  const heroRef = useRef<HTMLElement>(null);
  const [heroOn, setHeroOn] = useState(true);
  useEffect(() => {
    const el = heroRef.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver((en) => setHeroOn(!!en[0]?.isIntersecting), { threshold: 0.05 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const onMove = (e: React.PointerEvent<HTMLElement>) => {
    if (reduced) return;
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3));
    e.currentTarget.style.setProperty("--my", (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3));
  };

  const [ghost, setGhost] = useState("");
  const onGhost = useCallback((s: string) => setGhost(s), []);

  // monitor: reduced motion holds a still on the payoff, otherwise the programme loops muted
  const playerRef = useRef<PlayerRef>(null);
  const onMeta = useCallback(
    (m: PlayerMeta | null) => {
      if (!m || !reduced) return;
      window.setTimeout(() => playerRef.current?.seekTo(Math.floor(m.durationInFrames * 0.72)), 50);
    },
    [reduced],
  );

  const counts = hm.data ? countStatuses(hm.data.cells, "monetized") : null;
  const resume = pr.data ? resumeCandidate(pr.data.projects) : null;
  const usecases = hm.data?.usecases ?? [];
  const cells = hm.data?.cells ?? [];
  const sources = src.data?.sources ?? [];

  // ---- levels 2 + 3 (search-driven, so Back works)
  const openUc = usecases.find((u) => u.id === search.format) ?? null;
  const go = (next: FrontSearch, color?: string) => {
    const run = () => void navigate({ search: next, resetScroll: false });
    if (color) wipe(color, run);
    else run();
  };

  const format = props?.format ?? "vertical";
  const monitorClass = `monitor-wrap${format === "landscape" ? " monitor-wrap--wide" : ""}`;

  return (
    <main id="main" className={`landing${intro ? "" : " intro-done"}`}>
      {/* 01 · FRONT */}
      <section className="scene hero" id="front" aria-labelledby="h-front" ref={heroRef} onPointerMove={onMove}>
        <div className="beam beam--a" />
        <div className="beam beam--b" />
        <div className="beam beam--c" />
        <div className="floor" />
        <Dust on={!reduced && heroOn} />
        <div className="vignette" />
        <div className="frame">
          <div className="hero__ghost display num" aria-hidden="true">
            {ghost}
          </div>
          <div className="hero__copy">
            <p className="eyebrow">
              <i />A one-person sports channel · F1 · NBA · NHL · Soccer
            </p>
            <h1 className="display" id="h-front">
              <span className="ln">
                <span style={{ ["--i" as string]: 0 }}>Sports data,</span>
              </span>
              <span className="ln ln--brand">
                <span style={{ ["--i" as string]: 1 }}>on air.</span>
              </span>
              <span className="ln">
                <span style={{ ["--i" as string]: 2 }}>Rights cleared.</span>
              </span>
            </h1>
            <p className="body-lg">
              StatReel turns <b>licensed</b> sports data into narrated data videos: 9:16 shorts and 16:9 explainers.{" "}
              <b>Every video carries its licence lineage</b>, and a policy gate refuses to publish a monetized video
              built on non-commercial data.
            </p>
            <div className="hero__cta">
              <Link className="btn btn--primary" to="/heatmap" search={{ mode: "monetized" }}>
                Open heatmap
                {counts ? (
                  <span className="btn__meta num">
                    {counts.go} go · {counts["data-ready"]} ready
                  </span>
                ) : null}
              </Link>
              <Link className="btn" to="/studio">
                Open studio
              </Link>
              <a className="btn btn--ghost" href="#reel">
                {usecases.length || ""} formats
              </a>
            </div>
          </div>

          {resume ? (
            <Link className="resume" to="/studio/$projectId" params={{ projectId: resume.id }}>
              <span className="resume__tag">Resume</span>
              <span className="resume__body">
                <span className="resume__title">{resume.title}</span>
                <span className="resume__meta">
                  <span>
                    {resume.id} · {STAGE_LABEL[resume.status] ?? resume.status}
                  </span>
                  <span>{formatLabel(resume.format)}</span>
                  <span>{MODE_LABEL[resume.mode as Mode] ?? resume.mode}</span>
                </span>
              </span>
              <span className="resume__go" aria-hidden="true">
                <Arrow />
              </span>
            </Link>
          ) : (
            <div className="resume resume--none">
              <span className="resume__tag resume__tag--none">Resume</span>
              <span className="resume__body">
                <span className="resume__title">
                  {pr.isLoading ? "Reading the rundown" : pr.isError ? "Rundown offline" : "Nothing to resume"}
                </span>
                <span className="resume__meta">
                  <span>
                    {pr.data?.projects.length
                      ? "Every project is published"
                      : "No project yet — create one from a Go cell"}
                  </span>
                </span>
              </span>
            </div>
          )}

          <div className={monitorClass}>
            <div className="monitor">
              <div className="monitor__screen">
                <Programme
                  props={props}
                  format={format}
                  playerRef={playerRef}
                  onMeta={onMeta}
                  autoPlay={!reduced}
                  loop
                  muted
                  slate={
                    <Slate
                      title={programme.loading || pr.isLoading ? "Tuning in" : "Idle"}
                      lines={
                        pr.isError ? (
                          <p>The API did not answer, so there is no programme to show.</p>
                        ) : (
                          <p>No project with props yet — create one from a Go cell and draft it with the co-pilot.</p>
                        )
                      }
                    />
                  }
                />
              </div>
            </div>
          </div>
          {props ? (
            <Plate
              rows={props.rows}
              rawLabel={props.metric_raw_label}
              adjLabel={props.metric_adjusted_label}
              reduced={reduced}
              onGhost={onGhost}
            />
          ) : null}
          {detail ? (
            <div className="lineage-tag">
              <span>Lineage on this video</span>
              {manifest.data ? (
                manifest.data.data.sources.map((s) => (
                  <span key={s.id}>
                    {s.id} · {s.license}
                  </span>
                ))
              ) : (
                <span>{props?.attribution}</span>
              )}
              {policy ? (
                <b className={policy.allow ? "" : "is-deny"}>
                  <StatusChip
                    status={policy.allow ? "go" : "blocked"}
                    size={12}
                    label={policy.allow ? "GATE ALLOWS" : "GATE DENIES"}
                  />
                  {policy.target ? ` · ${policy.target.monetized ? "monetized" : "non-commercial"}` : ""}
                </b>
              ) : (
                <span className="lineage-tag__none">Not gated yet — produce it first</span>
              )}
            </div>
          ) : null}
          <p className="monitor__note">
            {detail ? (
              <>
                On the monitor: <b>{detail.project.title}</b> · props v{detail.props?.version}
                {props?.timing ? " · produced timing" : " · draft, no audio"}
                <br />
                <b>{props?.attribution}</b>
              </>
            ) : (
              "The monitor plays the newest project's real props through the EraAdjustedSlope composition."
            )}
          </p>
        </div>
        <Ticker />
      </section>

      {/* 02 · THE REEL */}
      <Reel
        usecases={usecases}
        cells={cells}
        onOpen={(u) => go({ format: u.id }, identVar(u.id))}
        loading={hm.isLoading}
        error={hm.isError}
      />

      {/* 03 · THE GATE */}
      <GateBand
        sources={sources}
        policy={policy}
        detail={detail}
        manifestSources={manifest.data?.data.sources ?? null}
      />

      {openUc ? (
        <Stage
          uc={openUc}
          index={usecases.indexOf(openUc)}
          usecases={usecases}
          cells={cells}
          sources={sources}
          sport={search.sport ?? null}
          mode={search.mode ?? "monetized"}
          go={go}
        />
      ) : null}
    </main>
  );
}

// ------------------------------------------------------------------ 02 reel

function Reel({
  usecases,
  cells,
  onOpen,
  loading,
  error,
}: {
  usecases: UseCase[];
  cells: HeatmapCell[];
  onOpen: (u: UseCase) => void;
  loading: boolean;
  error: boolean;
}) {
  const first = Math.max(
    0,
    usecases.findIndex((u) => cells.some((c) => c.usecase === u.id && c.composition_implemented)),
  );
  const [cur, setCur] = useState<number | null>(null);
  const i = cur ?? first;
  const u = usecases[i];
  const cels = useRef<(HTMLButtonElement | null)[]>([]);
  const focus = (n: number) => {
    const k = (n + usecases.length) % usecases.length;
    setCur(k);
    cels.current[k]?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight") focus(i + 1);
    else if (e.key === "ArrowLeft") focus(i - 1);
    else if (e.key === "Home") focus(0);
    else if (e.key === "End") focus(usecases.length - 1);
    else return;
    e.preventDefault();
  };
  const built = !!u && cells.some((c) => c.usecase === u.id && c.composition_implemented);
  const [l1, l2] = splitName(u?.name ?? "");
  return (
    <section
      className="scene reel"
      id="reel"
      aria-labelledby="h-reel"
      style={artStyle(u ? identVar(u.id) : "var(--color-brand)")}
    >
      <div className="reel__glow" />
      <div className="frame">
        <p className="eyebrow reel__head" id="h-reel">
          <i />
          02 · The reel — {usecases.length || "the"} formats the studio knows
        </p>
        {u ? (
          <>
            <div className="reel__artnum display num" aria-hidden="true">
              {pad2(i + 1)}
            </div>
            <div className="reel__art">
              <Ident key={u.id} id={u.id} name={u.name} live />
            </div>
            <div className="reel__stage">
              <div className="swap" key={u.id}>
                <p className="reel__no num">
                  FORMAT {pad2(i + 1)} / {pad2(usecases.length)} ·{" "}
                  {built
                    ? "COMPOSITION BUILT"
                    : u.composition
                      ? "COMPOSITION DESIGNED, NOT BUILT"
                      : "NO COMPOSITION YET"}
                </p>
                <h2 className="reel__name display">
                  <span>{l1}</span>
                  {l2 ? <span style={{ color: "var(--art)" }}>{l2}</span> : null}
                </h2>
                <p className="reel__blurb body-lg">
                  {u.notes ? `${u.notes}. ` : ""}
                  {u.duration_s.min}–{u.duration_s.max} s · complexity stage {u.stage}
                  {u.composition ? ` · composition ${u.composition}` : ""}
                </p>
                <div className="reel__meta">
                  <span className="chip">
                    <FormatIcon format={u.default_format} /> {formatLabel(u.default_format)} default
                  </span>
                  {u.requires.kinds.map((k) => (
                    <span className="chip" key={k}>
                      needs {kindLong(k)}
                    </span>
                  ))}
                  {SPORTS.map((sp) => {
                    const c = cellOf(cells, u.id, sp, "monetized");
                    return c ? (
                      <span className="chip chip--st" key={sp}>
                        {sp} <StatusChip status={c.status} size={12} />
                      </span>
                    ) : null;
                  })}
                </div>
                <button type="button" className="btn btn--primary reel__open" onClick={() => onOpen(u)}>
                  Open this format <Arrow />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="reel__stage">
            <p className="body-lg">
              {loading
                ? "Reading the use-case registry"
                : error
                  ? "The use-case registry did not load (API offline)."
                  : "No use cases in data/registry/usecases."}
            </p>
          </div>
        )}
        <div className="strip" role="listbox" aria-label="Formats" aria-orientation="horizontal" onKeyDown={onKey}>
          {usecases.map((x, j) => (
            <button
              type="button"
              key={x.id}
              ref={(el) => {
                cels.current[j] = el;
              }}
              className="cel"
              role="option"
              aria-selected={j === i}
              tabIndex={j === i ? 0 : -1}
              style={artStyle(identVar(x.id))}
              onMouseEnter={() => setCur(j)}
              onFocus={() => setCur(j)}
              onClick={() => onOpen(x)}
            >
              <span className="cel__n num">{pad2(j + 1)}</span>
              <span className="cel__art">
                <Ident id={x.id} name={x.name} />
              </span>
              <span className="cel__t">{x.name}</span>
            </button>
          ))}
        </div>
        <p className="reel__hint">
          <kbd>Left</kbd> <kbd>Right</kbd> choose · <kbd>Enter</kbd> open the format · idents are drawn, one per format
        </p>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ 03 gate band

function GateBand({
  sources,
  policy,
  detail,
  manifestSources,
}: {
  sources: Source[];
  policy: ReturnType<typeof renderPolicy>;
  detail: ProjectDetail | null;
  manifestSources: { id: string; license: string; license_class: string }[] | null;
}) {
  const v = verdictCounts(sources);
  const avoid = sources.filter((s) => s.verdict === "avoid");
  const pub = detail?.publications[0];
  return (
    <section className="scene gate" id="gate" aria-labelledby="h-gate">
      <div className="frame">
        <div className="gate__copy">
          <p className="eyebrow">
            <i />
            03 · Honest by construction
          </p>
          <h2 className="display" id="h-gate">
            The gate
            <br />
            says <em>no.</em>
          </h2>
          <p className="body-lg">
            Each source in the registry has a licence verdict. Each video inherits the verdict of everything it touched.
            A monetized video with one non-commercial input <b>does not leave the building</b>.
          </p>
          <dl className="counts">
            {(["legal", "non_commercial", "paid", "avoid"] as const).map((k) => (
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
          {avoid.length ? (
            <p className="never">
              Unreachable by design:{" "}
              {avoid.map((s) => (
                <s key={s.id}>{s.id}</s>
              ))}
            </p>
          ) : null}
        </div>
        <div className="chain">
          <p className="label">A video that airs · the last produced video, as the gate saw it</p>
          {detail && policy ? (
            <ol className="lane">
              <li className="lane__box">
                <span className="label">Sources</span>
                {(manifestSources ?? []).map((s) => (
                  <span key={s.id} className="lane__big">
                    {s.id} <LicChip cls={s.license_class} />
                  </span>
                ))}
                {!manifestSources ? <span className="lane__sub">reading the manifest</span> : null}
              </li>
              <li className="lane__box">
                <span className="label">
                  {detail.project.id} · {MODE_LABEL[detail.project.mode as Mode] ?? detail.project.mode}
                </span>
                <span className="lane__big">{detail.project.title}</span>
                <span className="lane__sub">{policy.checks_run.length} checks run</span>
              </li>
              <li className={`lane__gate ${policy.allow ? "is-allow" : "is-deny"}`}>
                <StatusChip
                  status={policy.allow ? "go" : "blocked"}
                  label={policy.allow ? "GATE PASSES" : "GATE REFUSES"}
                />
                {policy.deny.map((d) => (
                  <span key={d} className="lane__sub">
                    {d}
                  </span>
                ))}
              </li>
              <li className={`lane__box ${pub ? "lane__box--air" : "lane__box--none"}`}>
                <span className="label">{pub ? "Published" : "Not sent"}</span>
                <span className="lane__big">{pub ? pub.platform : "Nothing"}</span>
                <span className="lane__sub">
                  {pub ? `${pub.visibility}${pub.mode === "dry" ? " · dry run" : ""}` : "publish is the owner's call"}
                </span>
              </li>
            </ol>
          ) : (
            <div className="empty">
              <b>No gate verdict yet</b>
              The gate runs after Produce renders a video; nothing has been produced in this studio yet.
            </div>
          )}
          {detail && policy ? <Probe detail={detail} sources={sources} /> : null}
        </div>
      </div>
    </section>
  );
}

/** The same manifest plus one non-commercial registry source, through the real gate (read-only). */
function Probe({ detail, sources }: { detail: ProjectDetail; sources: Source[] }) {
  const nc = sources.find(
    (s) => s.verdict === "non_commercial" && (s.sport === detail.project.sport || s.sport === "all"),
  );
  const probe = useMutation({
    mutationFn: () =>
      api.policyProbe(
        detail.project.id,
        { platform: "youtube", monetized: true, ai_disclosure: true },
        { id: nc?.id ?? "", license_class: "non_commercial", verdict: "non_commercial" },
      ),
  });
  if (!nc) return null;
  const r = probe.data;
  return (
    <>
      <div className="lane-h">
        <p className="label">
          A video that does not · probe: add {nc.id} ({nc.license}) to the same video, monetized
        </p>
        {!r ? (
          <button type="button" className="btn btn--sm" onClick={() => probe.mutate()} disabled={probe.isPending}>
            {probe.isPending ? "Asking the gate" : "Run the probe"}
          </button>
        ) : null}
      </div>
      {probe.isError ? <p className="joberr">The probe failed: {errorText(probe.error)}</p> : null}
      {r ? (
        <ol className="lane">
          <li className="lane__box" style={{ borderColor: "var(--licence-non-commercial)" }}>
            <span className="label">Extra source</span>
            <span className="lane__big">
              {nc.id} <LicChip cls="non_commercial" />
            </span>
            <span className="lane__sub">{nc.license}</span>
          </li>
          <li className="lane__box">
            <span className="label">{detail.project.id} · monetized</span>
            <span className="lane__big">{detail.project.title}</span>
            <span className="lane__sub">{r.checks_run.length} checks run</span>
          </li>
          <li className={`lane__gate ${r.allow ? "is-allow" : "is-deny"}`}>
            <StatusChip status={r.allow ? "go" : "blocked"} label={r.allow ? "GATE PASSES" : "GATE REFUSES"} />
            {r.deny.map((d) => (
              <span key={d} className="lane__sub">
                {d}
              </span>
            ))}
          </li>
          <li className="lane__box lane__box--none">
            <span className="label">{r.allow ? "Would publish" : "Not sent"}</span>
            <span className="lane__big">{r.allow ? "Private" : "Nothing"}</span>
            <span className="lane__sub">
              {r.allow ? "" : "ask for a licence, or switch the project to non-commercial"}
            </span>
          </li>
        </ol>
      ) : (
        <p className="probe-note">
          The probe evaluates the last manifest plus that one source with the real OPA policy. Nothing is stored or
          published.
        </p>
      )}
    </>
  );
}

// ------------------------------------------------------------------ levels 2 + 3

function Stage({
  uc,
  index,
  usecases,
  cells,
  sources,
  sport,
  mode,
  go,
}: {
  uc: UseCase;
  index: number;
  usecases: UseCase[];
  cells: HeatmapCell[];
  sources: Source[];
  sport: Sport | null;
  mode: Mode;
  go: (s: FrontSearch, color?: string) => void;
}) {
  const level = sport ? 3 : 2;
  const back = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const create = useCreateProject();
  const color = identVar(uc.id);
  const up = useCallback(() => (sport ? go({ format: uc.id, mode }) : go({}, color)), [sport, go, uc.id, mode, color]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refocus on every level change
  useEffect(() => {
    back.current?.focus();
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, [uc.id, level]);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        up();
      } else if (e.key === "Tab" && root.current) {
        const f = [...root.current.querySelectorAll<HTMLElement>("button, a[href]")].filter(
          (n) => n.offsetParent !== null,
        );
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) {
          f[f.length - 1]?.focus();
          e.preventDefault();
        } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
          f[0]?.focus();
          e.preventDefault();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [up]);

  const prev = usecases[(index - 1 + usecases.length) % usecases.length];
  const next = usecases[(index + 1) % usecases.length];
  const cell = sport ? cellOf(cells, uc.id, sport, mode) : undefined;
  const built = cells.some((c) => c.usecase === uc.id && c.composition_implemented);
  const srcById = new Map(sources.map((s) => [s.id, s]));
  const never = sport ? neverFetchedFor(sources, sport, uc.requires.kinds) : [];

  return (
    <div
      className="stage"
      data-level={level}
      role="dialog"
      aria-modal="true"
      aria-labelledby="stageName"
      style={artStyle(color)}
      ref={root}
    >
      <div className="stage__bar">
        <div className="crumbs">
          <button type="button" onClick={() => go({}, color)}>
            Front
          </button>
          <i className="sep" />
          {level === 3 ? (
            <>
              <button type="button" onClick={() => go({ format: uc.id, mode })}>
                {pad2(index + 1)} {uc.name}
              </button>
              <i className="sep" />
              <span className="here">{sport} rights sheet</span>
            </>
          ) : (
            <span className="here">
              {pad2(index + 1)} {uc.name}
            </span>
          )}
        </div>
        <button type="button" className="btn btn--sm stage__back" ref={back} onClick={up}>
          <Arrow dir="left" />
          {level === 3 ? "Back to the format" : "Back to the reel"} <kbd>Esc</kbd>
        </button>
      </div>
      <div className="frame">
        <div className="stage__artnum display num" aria-hidden="true">
          {pad2(index + 1)}
        </div>
        <div className="stage__art">
          <Ident key={uc.id} id={uc.id} name={uc.name} live />
        </div>
        <p className="stage__artlabel">Drawn ident for this format. Not a screenshot.</p>
        {sport && cell ? (
          <div className="sheet-host">
            <div className="sheet">
              <div className="sheet__top">
                <h3>
                  {sport} · {MODE_LABEL[mode]}
                </h3>
                <StatusChip status={cell.status} />
              </div>
              <p className="sheet__why">{cell.reason}</p>
              {cell.kinds.map((k) => {
                const pass = allowedIn(mode, k.best);
                return (
                  <div className="krow" key={k.kind}>
                    <div className="krow__k">{kindLong(k.kind)}</div>
                    <div className="krow__s">
                      {k.sources.length ? (
                        k.sources.map((s) => (
                          <span key={s.id} className="krow__src">
                            <b>{s.id}</b> <LicChip cls={s.license_class} />{" "}
                            <i>
                              {srcById.get(s.id)?.license ?? ""} ·{" "}
                              {s.status === "declared" ? "declared, not tested" : s.status}
                            </i>
                          </span>
                        ))
                      ) : (
                        <i>No source in the registry</i>
                      )}
                    </div>
                    <div className={`verdict verdict--${pass ? "ok" : "no"}`}>
                      <StatusChip
                        status={pass ? "go" : k.best ? "ask" : "blocked"}
                        size={13}
                        label={
                          pass ? "CLEARS THIS MODE" : k.best ? "NOT IN THIS MODE" : k.tested ? "FAILING" : "NOT TESTED"
                        }
                      />
                    </div>
                  </div>
                );
              })}
              {never.length ? (
                <p className="off">
                  Never fetched for this cell:{" "}
                  {never.map((s) => (
                    <span key={s.id}>
                      <b>{s.id}</b> {s.license}{" "}
                    </span>
                  ))}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
        <div className="stage__side">
          <p className="reel__no num">
            FORMAT {pad2(index + 1)} / {pad2(usecases.length)} ·{" "}
            {built
              ? "COMPOSITION BUILT"
              : uc.composition
                ? `COMPOSITION ${uc.composition.toUpperCase()} NOT BUILT`
                : "NO COMPOSITION YET"}
          </p>
          <h2 className="stage__name display" id="stageName">
            {uc.name}
          </h2>
          <p className="stage__blurb body-lg">
            {uc.notes ? `${uc.notes}. ` : ""}
            {uc.duration_s.min}–{uc.duration_s.max} s
            {uc.requires.min_seasons ? ` · at least ${uc.requires.min_seasons} seasons` : ""}
          </p>
          <div className="stage__meta">
            <span className="chip">
              <FormatIcon format={uc.default_format} /> {formatLabel(uc.default_format)} default
            </span>
            <span className="chip">complexity stage {uc.stage}</span>
            {uc.requires.kinds.map((k) => (
              <span className="chip" key={k}>
                needs {kindLong(k)}
              </span>
            ))}
          </div>
          <div className="stage__rh">
            <h3>Rights by sport</h3>
            <div className="seg" role="group" aria-label="Mode">
              {(["monetized", "non_commercial"] as const).map((m) => (
                <button
                  type="button"
                  key={m}
                  aria-pressed={mode === m}
                  onClick={() => go({ format: uc.id, sport: sport ?? undefined, mode: m })}
                >
                  {MODE_LABEL[m]}
                </button>
              ))}
            </div>
          </div>
          <div className="tiles">
            {SPORTS.map((sp) => {
              const c = cellOf(cells, uc.id, sp, mode);
              const st: CellStatus = c?.status ?? "blocked";
              return (
                <button
                  type="button"
                  key={sp}
                  className={`tile st--${st}`}
                  aria-pressed={sport === sp}
                  onClick={() => go({ format: uc.id, sport: sport === sp ? undefined : sp, mode })}
                >
                  <Field sport={sp} />
                  <span className="tile__s">{sp}</span>
                  {c ? <StatusChip status={c.status} size={14} /> : <span className="tile__p">no cell</span>}
                  {c ? <span className="tile__p">{STATUS_AIR[c.status]}</span> : null}
                </button>
              );
            })}
          </div>
          <div className="stage__cta">
            {sport ? (
              <>
                <Link className="btn btn--primary" to="/heatmap" search={{ mode, cell: `${uc.id}|${sport}` }}>
                  Open in the heatmap <Arrow />
                </Link>
                <button
                  type="button"
                  className="btn"
                  disabled={create.isPending}
                  onClick={() => create.mutate({ usecase: uc, sport, mode })}
                >
                  {create.isPending ? "Creating" : "Create project"}
                </button>
                {create.isError ? <span className="stage__hint is-error">{String(create.error)}</span> : null}
              </>
            ) : (
              <span className="stage__hint">
                Pick a sport to read its rights sheet: which sources clear, which do not, which are never fetched.
              </span>
            )}
          </div>
        </div>
        <div className="stage__nav">
          {prev ? (
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              onClick={() => go({ format: prev.id, mode }, identVar(prev.id))}
            >
              <Arrow dir="left" />
              {pad2(usecases.indexOf(prev) + 1)} {prev.name}
            </button>
          ) : null}
          {next ? (
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              onClick={() => go({ format: next.id, mode }, identVar(next.id))}
            >
              {pad2(usecases.indexOf(next) + 1)} {next.name}
              <Arrow />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
