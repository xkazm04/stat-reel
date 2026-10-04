/**
 * Front · Photo Finish (A/3 port, ADR 006). StatReel as a photo-finish camera: the frame (STAT
 * arrives motion-smeared, the clay hairline sweeps in, REEL prints sharp on the cleared side,
 * slit-scan streaks cross the line and print as frames), the ten lanes (one per use case, status
 * per sport as a position relative to the line; a lane opens into its scene, then a sport's
 * finish picture), the line (the registry in real numbers) and the first short (the real
 * EraAdjustedSlope player with the newest project's props). A/3's brand panel is removed by the
 * owner. Every number comes from the API; missing data is a labelled state.
 */
import type { PlayerRef } from "@remotion/player";
import type { EraAdjustedProps, Format, HeatmapCell, Mode, Source, Sport, UseCase } from "@statreel/schemas";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import {
  type CSSProperties,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type ProjectDetail, type ProjectWithJobs, serverError } from "../api";
import { Defer } from "../components/arrive";
import { useCreateProject } from "../components/createProject";
import { DnsList, FinishPicture, LaneBar, ModeSwitch, SourceChip } from "../components/finish";
import { Arrow, FormatIcon, Glyph, NotEqual, StatusChip } from "../components/glyphs";
import { identVar } from "../components/idents";
import { LaneArt } from "../components/LaneArt";
import { Programme } from "../components/LazyProgramme";
import { OnTheLine } from "../components/OnTheLine";
import { RetryButton } from "../components/RetryButton";
import type { PlayerMeta } from "../components/Programme";
import { Slate } from "../components/Slate";
import { useReducedMotion } from "../components/ui";
import { Wordmark } from "../components/Wordmark";
import { latestRender, renderPolicy, useHeatmap, useProjects, useSources } from "../data";
import {
  acrossCount,
  clock,
  durationRange,
  heatmapWay,
  laneRotation,
  lanesLabel,
  loadCause,
  numberWord,
  REG_CLASSES,
  registryGrid,
  registryShare,
  sceneStrip,
  splitNeq,
  sportsPhrase,
  studioCounts,
} from "../frontpf";
import { inertOutside } from "../inertBackground";
import { cellOf, countStatuses, MODE_LABEL, SPORTS, STAGE_LABEL } from "../logic";
import {
  biggestMovers,
  fmtDuration,
  formatLabel,
  kindLong,
  LICENCE_WORD,
  neverFetchedFor,
  pad2,
  resumeCandidate,
  STATUS_AIR,
  STATUS_ORDER,
  STATUS_WORD,
  splitName,
  verdictCounts,
} from "../display";
import type { FrontSearch } from "../router";
import { useProgramme } from "./useProgramme";

const css = (o: Record<string, string | number>): CSSProperties => o as CSSProperties;
/** A use case's lane colour: its ident token (Photo Finish maps idents onto the ten lane colours). */
const laneOf = (id: string | undefined): string => (id ? identVar(id) : "var(--color-text-muted)");
/** Keyed by the schema's Format, so a new format without words is a type error. */
const FMT_WORD: Record<Format, string> = { vertical: "9:16 short", landscape: "16:9 explainer" };

// ------------------------------------------------------------------ shared: the opening row

/** Where the scene opens from (the row the owner chose); read once by the scene. */
let openFrom: DOMRect | null = null;

// ------------------------------------------------------------------ page

export function FrontPhotoFinish() {
  const search = useSearch({ from: "/" }) as FrontSearch;
  const navigate = useNavigate({ from: "/" });
  const reduced = useReducedMotion();
  const hm = useHeatmap();
  const src = useSources();
  const pr = useProjects();
  const programme = useProgramme(pr.data?.projects);

  const mode: Mode = search.mode ?? "monetized";
  const usecases = hm.data?.usecases ?? [];
  const cells = hm.data?.cells ?? [];
  const sources = src.data?.sources ?? [];
  const setMode = useCallback(
    (m: Mode) => void navigate({ search: (s: FrontSearch) => ({ ...s, mode: m }), replace: true, resetScroll: false }),
    [navigate],
  );
  const openUc = usecases.find((u) => u.id === search.format) ?? null;
  const go = useCallback(
    (next: FrontSearch) => void navigate({ search: next, resetScroll: false }),
    [navigate],
  );

  return (
    <main id="main" className="pf-landing">
      <Frame
        mode={mode}
        sources={sources}
        srcState={src}
        heatmap={hm}
        cells={cells}
        usecases={usecases}
        projects={pr}
        reduced={reduced}
      />
      <Defer tier={openUc ? 0 : 1} id="pf:lanes" anchor="pf-lanes" phClass="pf-lanes" minHeight="80vh">
        <Lanes
          usecases={usecases}
          cells={cells}
          mode={mode}
          setMode={setMode}
          reduced={reduced}
          loading={hm.isLoading}
          error={hm.isError ? loadCause(hm.error) : null}
          onRetry={() => void hm.refetch()}
          retrying={hm.isFetching}
          sceneOpen={!!openUc}
          onOpen={(u) => go({ format: u.id, mode })}
        />
      </Defer>
      <Defer tier={2} id="pf:line" visible anchor="pf-line" phClass="pf-line" minHeight="70vh">
        <TheLine
          sources={sources}
          mode={mode}
          setMode={setMode}
          loading={src.isLoading}
          error={src.isError ? loadCause(src.error) : null}
          onRetry={() => void src.refetch()}
          retrying={src.isFetching}
        />
      </Defer>
      <Defer tier={3} id="pf:short" visible anchor="pf-short" phClass="pf-short" minHeight="70vh">
        <FirstShort
          detail={programme.detail}
          loading={programme.loading || pr.isLoading}
          error={pr.isError ? loadCause(pr.error) : null}
          onRetry={() => void pr.refetch()}
          retrying={pr.isFetching}
          usecases={usecases}
          reduced={reduced}
        />
      </Defer>
      <footer className="pf-foot deco-ticks">
        <a className="pf-foot__mark" href="#pf-frame" aria-label="Back to the top">
          <Wordmark />
        </a>
        <span>
          Every number on this page is read from the registry, the heatmap and the rundown. The lane artwork is stylised;
          nothing here is a screenshot of a real video.
        </span>
        <nav aria-label="Pages">
          <Link to="/heatmap">Heatmap</Link>
          <Link to="/studio">Studio</Link>
          <Link to="/calendar">Calendar</Link>
          <a href="#pf-frame">Top</a>
        </nav>
      </footer>
      {openUc ? (
        <LaneScene
          uc={openUc}
          index={usecases.indexOf(openUc)}
          usecases={usecases}
          cells={cells}
          sources={sources}
          sport={search.sport ?? null}
          mode={mode}
          reduced={reduced}
          go={go}
          setMode={setMode}
        />
      ) : null}
    </main>
  );
}

// ------------------------------------------------------------------ 1 · the frame

type Q<T> = { data?: T; error?: unknown; isLoading: boolean; isError: boolean; isFetching: boolean; refetch: () => unknown };

function Frame({
  mode,
  sources,
  srcState,
  heatmap,
  cells,
  usecases,
  projects,
  reduced,
}: {
  mode: Mode;
  sources: Source[];
  srcState: Q<unknown>;
  heatmap: Q<unknown>;
  cells: HeatmapCell[];
  usecases: UseCase[];
  projects: Q<{ projects: ProjectWithJobs[] }>;
  reduced: boolean;
}) {
  const frame = useRef<HTMLElement>(null);
  const lineRef = useRef<HTMLSpanElement>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const waysRef = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const [live, setLive] = useState(false);
  const [skip, setSkip] = useState(reduced);
  const [lx, setLx] = useState(0);

  const v = verdictCounts(sources);
  const sports = sportsPhrase(sources);
  const span = durationRange(usecases);
  const across = acrossCount(sources, mode);
  const n = countStatuses(cells, mode);
  const perMode = cells.filter((c) => c.mode === mode).length;
  const heatState = heatmapWay(heatmap, perMode);
  const list = projects.data?.projects ?? [];
  const sc = studioCounts(list);
  const resume = resumeCandidate(list) ?? [...list].sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;

  // measure: where the line stands in the frame (the gap between STAT and REEL)
  const measure = useCallback(() => {
    const f = frame.current;
    const l = lineRef.current;
    const sp = splitRef.current;
    if (!f || !l || !sp) return;
    const fr = f.getBoundingClientRect();
    const r = l.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2 - fr.left);
    f.style.setProperty("--lx", `${x}px`);
    f.style.setProperty("--hl-h", `${Math.round(sp.getBoundingClientRect().top - fr.top)}px`);
    setLx(x);
  }, []);
  useLayoutEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      measure();
      setLive(true);
    };
    void document.fonts?.ready.then(go);
    const t = window.setTimeout(go, 700);
    return () => {
      window.removeEventListener("resize", measure);
      window.clearTimeout(t);
    };
  }, [measure]);
  // any input skips the intro
  useEffect(() => {
    if (skip) return;
    const s = () => setSkip(true);
    const evs = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    for (const e of evs) window.addEventListener(e, s, { once: true, passive: true });
    return () => {
      for (const e of evs) window.removeEventListener(e, s);
    };
  }, [skip]);
  // the readout: a stopwatch since the page opened (reduced motion: still)
  useEffect(() => {
    const el = timeRef.current;
    if (!el) return;
    if (reduced) {
      el.textContent = clock(0);
      return;
    }
    // runs only while the frame is on screen and the tab is visible (mirrors useScan); the clock
    // keeps counting from the page opening, so a pause hides time rather than losing it
    const t0 = performance.now();
    let raf = 0;
    let visible = true;
    const tick = () => {
      raf = 0;
      el.textContent = clock((performance.now() - t0) / 1000);
      if (visible && !document.hidden) raf = window.requestAnimationFrame(tick);
    };
    const start = () => {
      if (!raf) raf = window.requestAnimationFrame(tick);
    };
    start();
    const onVis = () => {
      if (!document.hidden && visible) start();
    };
    document.addEventListener("visibilitychange", onVis);
    const fr = frame.current;
    const io =
      fr && "IntersectionObserver" in window
        ? new IntersectionObserver(
            (en) => {
              visible = !!en[0]?.isIntersecting;
              if (visible) start();
            },
            { threshold: 0.02 },
          )
        : null;
    if (fr) io?.observe(fr);
    return () => {
      window.cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVis);
      io?.disconnect();
    };
  }, [reduced]);

  useScan(canvas, frame, splitRef, waysRef, lx, reduced);

  const heatNum = STATUS_ORDER.filter((k) => n[k]).map((k, i) => (
    <span key={k}>
      {i ? ", " : ""}
      <b className="num">{n[k]}</b> {STATUS_WORD[k].toLowerCase()}
    </span>
  ));

  return (
    <section
      className={`pf-frame${live ? " is-live" : ""}${skip ? " is-skip" : ""}`}
      id="pf-frame"
      aria-labelledby="pf-h1"
      ref={frame}
    >
      <canvas className="pf-scan" ref={canvas} aria-hidden="true" />
      <div className="pf-frame__inner">
        <div className="pf-frame__top">
          <p className="eyebrow">
            <b>A photo-finish camera for sports data</b>
          </p>
          <nav className="pf-sections" aria-label="On this page">
            <a href="#pf-lanes">{lanesLabel(usecases.length)}</a>
            <a href="#pf-line">The line</a>
            <a href="#pf-short">The first short</a>
          </nav>
        </div>
        <div className="pf-poster-wrap">
          <h1 className="pf-poster" id="pf-h1">
            <span className="sr-only">StatReel: licensed sports data in, data videos that move through time out.</span>
            <span className="pf-poster__a" aria-hidden="true">
              Stat
            </span>
            <span className="pf-poster__line" ref={lineRef} aria-hidden="true" />
            <span className="pf-poster__b" aria-hidden="true">
              Reel
            </span>
          </h1>
        </div>
        <div className="pf-split" ref={splitRef}>
          <div className="pf-split__l" style={css({ "--d": 0 })}>
            <p className="eyebrow">In · before the line</p>
            <h2>Licensed sports data</h2>
            <p>
              {srcState.isError ? (
                <>
                  The registry did not load ({loadCause(srcState.error)}), so there is nothing to count.{" "}
                  <RetryButton onRetry={() => void srcState.refetch()} busy={srcState.isFetching} />
                </>
              ) : srcState.isLoading ? (
                "Reading the registry."
              ) : (
                <>
                  {sports ? `${sports}, from` : "From"} a registry of <strong className="num">{sources.length}</strong> sources
                  with a licence verdict on each. <strong className="num">{v.avoid}</strong> of them never start.
                </>
              )}
            </p>
          </div>
          <div className="pf-split__r" style={css({ "--d": 1 })}>
            <p className="eyebrow">Out · across the line</p>
            <h2>Data videos through time</h2>
            <p>
              Stats that move through time{span ? <>, <strong className="num">{span}</strong> long</> : null}
              {usecases.length ? (
                <>
                  {" "}
                  in <strong className="num">{usecases.length}</strong> formats
                </>
              ) : null}
              . Each carries its licence lineage, and a gate refuses a monetized video built on non-commercial data.
            </p>
          </div>
        </div>
        <nav className="pf-ways" aria-label="Ways into the work" ref={waysRef}>
          <Link className="pf-way" to="/heatmap" search={{ mode, view: "feasibility" }} style={css({ "--d": 2 })}>
            <span className="pf-way__no num">01</span>
            <span className="pf-way__label">Open the heatmap</span>
            <span className="pf-way__detail">
              <span>
                {heatState === "ready" ? (
                  <>
                    <b className="num">{perMode}</b> cell{perMode === 1 ? "" : "s"} (use case × sport) in{" "}
                    {MODE_LABEL[mode].toLowerCase()} mode: {heatNum}
                  </>
                ) : heatState === "error" ? (
                  // the way itself opens the heatmap, whose Failure retries; no second control inside a link
                  `The heatmap did not load (${loadCause(heatmap.error)}).`
                ) : heatState === "loading" ? (
                  "Reading the heatmap."
                ) : (
                  `The heatmap has no cells in ${MODE_LABEL[mode].toLowerCase()} mode yet.`
                )}
              </span>
              <Arrow />
            </span>
          </Link>
          <Link className="pf-way" to="/projects" style={css({ "--d": 3 })}>
            <span className="pf-way__no num">02</span>
            <span className="pf-way__label">Open the rundown</span>
            <span className="pf-way__detail">
              <span>
                {projects.isError ? (
                  <>
                    The rundown did not load ({loadCause(projects.error)}).{" "}
                    <RetryButton onRetry={() => void projects.refetch()} busy={projects.isFetching} />
                  </>
                ) : list.length ? (
                  <>
                    <b className="num">{sc.total}</b> project{sc.total === 1 ? "" : "s"},{" "}
                    <b className="num">{sc.published}</b> published, <b className="num">{sc.refused}</b> the gate
                    refused, <b className="num">{sc.gated}</b> cleared the gate, <b className="num">{sc.notGated}</b> not
                    gated yet
                  </>
                ) : projects.isLoading ? (
                  "Reading the rundown."
                ) : (
                  "No project yet: create one from a Go cell."
                )}
              </span>
              <Arrow />
            </span>
          </Link>
          {resume ? (
            <Link
              className="pf-way"
              to="/studio/$projectId"
              params={{ projectId: resume.id }}
              style={css({ "--d": 4 })}
            >
              <span className="pf-way__no num">03</span>
              <span className="pf-way__label">Resume the last video</span>
              <span className="pf-way__detail">
                <span>
                  <b>{resume.title}</b>
                </span>
                <span className="tag">
                  {(STAGE_LABEL[resume.status] ?? resume.status).toLowerCase()} · {formatLabel(resume.format)}
                </span>
                <Arrow />
              </span>
            </Link>
          ) : (
            <div className="pf-way pf-way--none" style={css({ "--d": 4 })}>
              <span className="pf-way__no num">03</span>
              <span className="pf-way__label">Resume the last video</span>
              <span className="pf-way__detail">
                <span>{projects.isLoading ? "Reading the rundown." : "Nothing to resume yet."}</span>
              </span>
            </div>
          )}
          <OnTheLine variant="way" style={css({ "--d": 5 })} />
        </nav>
      </div>
      <div className="pf-hairline" aria-hidden="true">
        <div className="pf-readout">
          <span className="pf-readout__time num" ref={timeRef}>
            0:00.000
          </span>
          <span className="pf-readout__label">
            <span className="pf-readout__pre">Licence line{sources.length ? " · " : ""}</span>
            {sources.length ? `${across} of ${sources.length} sources across` : null}
          </span>
        </div>
      </div>
    </section>
  );
}

/** The slit-scan canvas (A/3): lanes, smeared streaks before the line, printed frames after it. */
function useScan(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  frameRef: RefObject<HTMLElement | null>,
  splitRef: RefObject<HTMLDivElement | null>,
  waysRef: RefObject<HTMLElement | null>,
  lx: number,
  reduced: boolean,
) {
  useEffect(() => {
    const cv = canvasRef.current;
    const fr = frameRef.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !fr || !ctx || !lx) return;
    const root = getComputedStyle(document.documentElement);
    const tok = (n: string, d: string) => root.getPropertyValue(n).trim() || d;
    const hex = (h: string): [number, number, number] => {
      const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
      const n = m ? Number.parseInt(m[1] as string, 16) : 0x888888;
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    const rgba = (h: string, a: number) => {
      const [r, g, b] = hex(h);
      return `rgba(${r},${g},${b},${a})`;
    };
    const cols = Array.from({ length: 10 }, (_, i) => tok(`--lane-${i + 1}`, "#566a90"));
    const band = tok("--color-surface-2", "#e3e8ec");
    const rule = tok("--color-line-strong", "#8f9aa5");
    const ink = tok("--color-text-muted", "#38414a");
    const dim = tok("--color-text-dim", "#56616c");
    const sig = tok("--color-brand", "#b8321a");
    let seed = 20260930 >>> 0;
    const rnd = () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    type Slice = { y: number; h: number; l: number; a: number; off: number; core: boolean };
    type Streak = { k: number; col: string; v: number; len: number; q: number; crossed: boolean; yo: number; slices: Slice[] };
    type Print = { k: number; col: string; fw: number; fh: number; slot: number; S: number; p: number; v: number; hold: number; a: number; yo: number; dying: boolean };
    type LaneRow = { y: number; h: number };
    let W = 0;
    let H = 0;
    let dpr = 1;
    let lanes: LaneRow[] = [];
    let zone = 0;
    let streaks: Streak[] = [];
    let prints: Print[] = [];
    let marks: { k: number; t: number; a: number }[] = [];
    let last = 0;
    let raf = 0;
    let visible = true;
    const t0 = performance.now();
    const spawn = (k: number, pre: boolean, n: number): Streak => {
      const s: Streak = {
        k,
        col: cols[Math.floor(rnd() * 10)] as string,
        v: (0.075 + rnd() * 0.075) * W,
        len: (0.34 + rnd() * 0.36) * W,
        q: pre ? (n ? 0.15 + rnd() * 0.4 : 0.62 + rnd() * 0.36) * lx : -rnd() * 0.22 * W - 30,
        crossed: false,
        yo: 0.5 + (rnd() - 0.5) * 0.1,
        slices: [],
      };
      const m = 26;
      const spread = 0.46 + rnd() * 0.36;
      for (let j = 0; j < m; j++) {
        const u = ((j + 0.5) / m) * 2 - 1;
        const env = Math.exp(-u * u * 2.6);
        s.slices.push({ y: (u * spread) / 2, h: spread / m, l: 0.25 + rnd() * 0.75, a: env * (0.26 + rnd() * 0.46), off: rnd() * rnd() * 0.05 * W, core: env > 0.5 });
      }
      return s;
    };
    const print = (s: Streak): Print => {
      const ln = lanes[s.k] as LaneRow;
      const vertical = rnd() < 0.6;
      const fh = ln.h * (vertical ? 0.78 : 0.5);
      const fw = vertical ? (fh * 9) / 16 : (fh * 16) / 9;
      const right = W - lx;
      const slots = Math.max(3, Math.floor((right - 40) / (fw + 28)));
      const used = prints.filter((p) => p.k === s.k);
      let slot = 0;
      let tries = 0;
      do {
        slot = Math.floor(rnd() * slots);
        tries++;
      } while (tries < 8 && used.some((p) => p.slot === slot));
      if (used.length >= 2 && used[0]) used[0].dying = true;
      const pr: Print = { k: s.k, col: s.col, fw, fh, slot, S: lx + 24 + (slot * (right - 48 - fw)) / Math.max(1, slots - 1), p: lx, v: s.v, hold: 0, a: 1, yo: s.yo, dying: false };
      prints.push(pr);
      return pr;
    };
    const layout = () => {
      const r = fr.getBoundingClientRect();
      W = r.width;
      H = r.height;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      const quiet = (splitRef.current?.getBoundingClientRect().top ?? r.bottom) - r.top;
      const mobile = W < 861;
      const n = mobile ? 4 : 5;
      zone = quiet - (mobile ? 0 : 6);
      const lh = zone / n;
      lanes = Array.from({ length: n }, (_, k) => ({ y: k * lh, h: lh }));
      streaks = [];
      prints = [];
      marks = [];
      lanes.forEach((_, k) => {
        if (k === 0) return; // lane 1 carries the ruler and the readout
        streaks.push(spawn(k, true, 0));
        if (!mobile) streaks.push(spawn(k, true, 1));
        const lastS = streaks[streaks.length - 1] as Streak;
        const pr = print(lastS);
        pr.p = pr.S + pr.fw;
        pr.hold = rnd() * 2;
        if (!mobile && rnd() < 0.7) {
          const p2 = print(streaks[streaks.length - 2] as Streak);
          p2.p = p2.S + p2.fw;
        }
      });
    };
    const step = (dt: number) => {
      streaks.forEach((s, i) => {
        s.q += s.v * dt;
        if (!s.crossed && s.q >= lx) {
          s.crossed = true;
          print(s);
          marks = marks.filter((m) => m.k !== s.k);
          marks.push({ k: s.k, t: (performance.now() - t0) / 1000, a: 1 });
        }
        if (s.q - s.len > lx) streaks[i] = spawn(s.k, false, 0);
      });
      for (const p of prints) {
        const rem = p.S + p.fw - p.p;
        if (rem > 0.6) p.p += Math.min(p.v * 1.4, Math.max(12, rem * 2.2)) * dt;
        else p.hold += dt;
        if (p.dying || p.hold > 9) p.a -= dt * 1.2;
      }
      prints = prints.filter((p) => p.a > 0);
      for (const m of marks) m.a -= dt * 0.42;
      marks = marks.filter((m) => m.a > 0);
    };
    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      lanes.forEach((ln, i) => {
        if (i % 2 === 0) {
          ctx.fillStyle = rgba(band, 0.55);
          ctx.fillRect(0, ln.y, W, ln.h);
        }
        ctx.fillStyle = rgba(rule, 0.5);
        ctx.fillRect(0, Math.round(ln.y + ln.h) - 0.5, W, 1);
      });
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, lx, zone);
      ctx.clip();
      ctx.globalCompositeOperation = "multiply";
      for (const s of streaks) {
        const ln = lanes[s.k] as LaneRow;
        const cy = ln.y + ln.h * s.yo;
        const head = s.q;
        if (head - s.len > lx) continue;
        const bw = ln.h * 1.7;
        for (const sl of s.slices) {
          const x1 = head - sl.off;
          const x0 = x1 - s.len * sl.l;
          const hh = ln.h * sl.h + 0.6;
          const y = cy + ln.h * sl.y - hh / 2;
          const g = ctx.createLinearGradient(x0, 0, x1, 0);
          g.addColorStop(0, rgba(s.col, 0));
          g.addColorStop(0.75, rgba(s.col, sl.a * 0.6));
          g.addColorStop(1, rgba(s.col, sl.a));
          ctx.fillStyle = g;
          ctx.fillRect(x0, y, x1 - x0, hh);
          if (sl.core) {
            const g2 = ctx.createLinearGradient(x1 - bw, 0, x1, 0);
            g2.addColorStop(0, rgba(s.col, 0));
            g2.addColorStop(1, rgba(s.col, 0.5));
            ctx.fillStyle = g2;
            ctx.fillRect(x1 - bw, y, bw, hh);
          }
        }
      }
      ctx.restore();
      ctx.save();
      ctx.beginPath();
      ctx.rect(lx, 0, W - lx, zone);
      ctx.clip();
      for (const s of prints) {
        const ln = lanes[s.k] as LaneRow;
        const x = s.p - s.fw;
        const y = ln.y + ln.h * s.yo - s.fh / 2;
        ctx.globalAlpha = Math.max(0, s.a);
        ctx.fillStyle = "rgba(255,255,255,.82)";
        ctx.fillRect(x, y, s.fw, s.fh);
        ctx.fillStyle = rgba(s.col, 0.16);
        ctx.fillRect(x, y, s.fw, s.fh);
        ctx.strokeStyle = s.col;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 0.75, y + 0.75, s.fw - 1.5, s.fh - 1.5);
        ctx.beginPath();
        ctx.lineWidth = 2;
        ctx.moveTo(x + s.fw * 0.18, y + s.fh * 0.62);
        ctx.lineTo(x + s.fw * 0.42, y + s.fh * 0.44);
        ctx.lineTo(x + s.fw * 0.6, y + s.fh * 0.52);
        ctx.lineTo(x + s.fw * 0.82, y + s.fh * 0.26);
        ctx.stroke();
        ctx.fillStyle = s.col;
        ctx.fillRect(x + s.fw * 0.18, y + s.fh * 0.8, s.fw * 0.64, Math.max(2, s.fh * 0.045));
        ctx.globalAlpha = 1;
      }
      ctx.restore();
      const fs = Math.max(12, rem * 0.72);
      ctx.font = `500 ${fs}px "JetBrains Mono", monospace`;
      ctx.textBaseline = "top";
      const unit = Math.max(8, rem * 0.62);
      for (let k = -Math.ceil(lx / unit); k * unit < W - lx; k++) {
        const x = lx + k * unit;
        const big = k % 10 === 0;
        const mid = k % 5 === 0;
        ctx.fillStyle = big ? rgba(ink, 0.9) : rgba(rule, 0.9);
        ctx.fillRect(Math.round(x), 0, 1, big ? 12 : mid ? 8 : 4);
        if (big && k !== 0 && Math.abs(x - lx) > rem * 9 && x > rem * 2 && x < W - rem * 4) {
          ctx.fillStyle = dim;
          ctx.textAlign = "center";
          ctx.fillText(`${k > 0 ? "+" : "-"}${(Math.abs(k) / 100).toFixed(2)}`, x, 15);
        }
      }
      ctx.textAlign = "left";
      lanes.forEach((ln, i) => {
        ctx.fillStyle = dim;
        ctx.fillText(pad2(i + 1), Math.max(8, rem * 0.7), ln.y + ln.h - fs - 5);
      });
      if (W >= 861)
        for (const m of marks) {
          const ln = lanes[m.k] as LaneRow;
          ctx.globalAlpha = Math.min(1, m.a * 1.6);
          ctx.fillStyle = sig;
          ctx.fillRect(lx, ln.y + ln.h - 3, 26, 2);
          ctx.fillText(m.t.toFixed(3), lx + 8, ln.y + ln.h - fs - 6);
          ctx.globalAlpha = 1;
        }
    };
    const loop = (ts: number) => {
      raf = 0;
      const dt = Math.min(0.05, (ts - last) / 1000 || 0);
      last = ts;
      step(dt);
      draw();
      if (visible && !document.hidden) raf = window.requestAnimationFrame(loop);
    };
    const start = () => {
      if (reduced) {
        draw();
        return;
      }
      if (!raf) {
        last = performance.now();
        raf = window.requestAnimationFrame(loop);
      }
    };
    layout();
    draw();
    start();
    const onResize = () => {
      layout();
      draw();
    };
    window.addEventListener("resize", onResize);
    const onVis = () => {
      if (!document.hidden && visible) start();
    };
    document.addEventListener("visibilitychange", onVis);
    const io =
      "IntersectionObserver" in window
        ? new IntersectionObserver(
            (en) => {
              visible = !!en[0]?.isIntersecting;
              if (visible) start();
            },
            { threshold: 0.02 },
          )
        : null;
    io?.observe(fr);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVis);
      io?.disconnect();
    };
  }, [canvasRef, frameRef, splitRef, lx, reduced]);
  void waysRef;
}

// ------------------------------------------------------------------ 2 · ten lanes

function Lanes({
  usecases,
  cells,
  mode,
  setMode,
  reduced,
  loading,
  error,
  onRetry,
  retrying,
  sceneOpen,
  onOpen,
}: {
  usecases: UseCase[];
  cells: HeatmapCell[];
  mode: Mode;
  setMode: (m: Mode) => void;
  reduced: boolean;
  loading: boolean;
  /** why the use cases did not load (loadCause), null when they did */
  error: string | null;
  onRetry: () => void;
  retrying: boolean;
  sceneOpen: boolean;
  onOpen: (u: UseCase) => void;
}) {
  const first = Math.max(
    0,
    usecases.findIndex((u) => cells.some((c) => c.usecase === u.id && c.composition_implemented)),
  );
  const [active, setActive] = useState<number | null>(null);
  // touched = the owner paused it (the pause button, or acting on a lane); hovered / focused hold it
  const [touched, setTouched] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [stageKey, setStageKey] = useState(0);
  const sec = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const i = active ?? first;
  const u = usecases[i];
  const rot = laneRotation({ reduced, paused: touched, hovered, focused, sceneOpen, count: usecases.length });

  const pick = (k: number, quiet = false) => {
    if (k === i && active !== null) return;
    setActive(k);
    if (!quiet) setStageKey((s) => s + 1);
  };
  // idle: the stage cycles through the lanes while the section is in view (never with reduced motion)
  useEffect(() => {
    if (!rot.auto) return;
    const iv = window.setInterval(() => {
      const r = sec.current?.getBoundingClientRect();
      if (!r || r.bottom < 80 || r.top > window.innerHeight - 80) return;
      setActive((a) => ((a ?? first) + 1) % usecases.length);
      setStageKey((s) => s + 1);
    }, 3200);
    return () => window.clearInterval(iv);
  }, [rot.auto, usecases.length, first]);

  const open = (k: number, row: HTMLElement | null) => {
    const x = usecases[k];
    if (!x) return;
    openFrom = row?.getBoundingClientRect() ?? null;
    onOpen(x);
  };
  const onRowClick = (k: number, e: React.MouseEvent<HTMLButtonElement>) => {
    setTouched(true);
    const pe = (e.nativeEvent as PointerEvent).pointerType;
    const armed = e.currentTarget.dataset.armed === "1";
    for (const b of e.currentTarget.parentElement?.querySelectorAll<HTMLElement>("[data-armed]") ?? []) delete b.dataset.armed;
    e.currentTarget.dataset.armed = "1";
    if (pe === "touch" && !(armed && k === i)) {
      pick(k);
      if (window.innerWidth < 861) stageRef.current?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
      return;
    }
    open(k, e.currentTarget);
  };
  const n = countStatuses(cells, mode);
  const go = cells.filter((c) => c.mode === mode && c.status === "go");
  const [l1, l2] = u ? (u.name.length <= 14 ? [u.name, ""] : splitName(u.name)) : ["", ""];
  const built = !!u && cells.some((c) => c.usecase === u.id && c.composition_implemented);

  return (
    <section
      className="pf-lanes"
      id="pf-lanes"
      aria-labelledby="pf-lanes-h"
      ref={sec}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <div className="pf-lanes__head">
        <nav className="pf-crumbs" aria-label="Where you are">
          <a href="#pf-frame">StatReel</a>
          <span className="pf-crumbs__sep" />
          <span aria-current="true">{lanesLabel(usecases.length)}</span>
        </nav>
        <h2 id="pf-lanes-h">
          {lanesLabel(usecases.length)} <em>· {usecases.length ? `${numberWord(usecases.length).toLowerCase()} kinds of video` : "the kinds of video"}</em>
        </h2>
        <div className="pf-lanes__right">
          <span className="pf-hint">Point at, focus or tap a lane. Enter opens its scene.</span>
          {rot.control ? (
            // Play / Pause name the operation the press performs; no aria-pressed on top of a name that
            // already changes (it read "Play lane rotation, pressed" while the rotation was paused)
            <button type="button" className="btn btn--sm" onClick={() => setTouched((t) => !t)}>
              {touched ? "Play lane rotation" : "Pause lane rotation"}
            </button>
          ) : null}
          <ModeSwitch mode={mode} onChange={setMode} label="Line at" />
        </div>
      </div>
      {error ? (
        <p className="pf-lanes__msg" role="alert">
          The use-case registry did not load ({error}). <RetryButton onRetry={onRetry} busy={retrying} />
        </p>
      ) : loading ? (
        <p className="pf-lanes__msg">Reading the use-case registry.</p>
      ) : !usecases.length ? (
        <p className="pf-lanes__msg">No use cases in data/registry/usecases.</p>
      ) : (
        <div className="pf-strip">
          <div className="pf-strip__cols" aria-hidden="true">
            <span>LANE</span>
            <span className="pf-strip__finish">WHERE IT STANDS TO THE LINE</span>
            {SPORTS.map((s) => (
              <span className="c" key={s}>
                {s === "Soccer" ? "SOC" : s.toUpperCase()}
              </span>
            ))}
          </div>
          <div className="pf-strip__rows">
            {usecases.map((x, k) => {
              const label = SPORTS.map((sp) => {
                const c = cellOf(cells, x.id, sp, mode);
                return `${sp} ${c ? STATUS_WORD[c.status] : "no cell"}`;
              }).join(", ");
              return (
                <button
                  type="button"
                  key={x.id}
                  className={`pf-ln${k === i ? " is-active" : ""}`}
                  style={css({ "--lane-color": laneOf(x.id) })}
                  aria-label={`Lane ${k + 1}, ${x.name}. ${label}. Open its scene.`}
                  onPointerOver={(e) => {
                    if (e.pointerType !== "mouse") return;
                    setTouched(true);
                    pick(k);
                  }}
                  onFocus={() => {
                    setTouched(true);
                    pick(k);
                  }}
                  onClick={(e) => onRowClick(k, e)}
                  onKeyDown={(e) => {
                    const sib =
                      e.key === "ArrowDown"
                        ? e.currentTarget.nextElementSibling
                        : e.key === "ArrowUp"
                          ? e.currentTarget.previousElementSibling
                          : null;
                    if (sib instanceof HTMLElement) {
                      e.preventDefault();
                      sib.focus();
                    }
                  }}
                >
                  <span className="pf-ln__id">
                    <span className="pf-ln__no num">{pad2(k + 1)}</span>
                    <span className="pf-ln__name">{x.name}</span>
                  </span>
                  <span className="pf-ln__mid">
                    <i className="pf-ln__streak" />
                  </span>
                  {SPORTS.map((sp) => {
                    const c = cellOf(cells, x.id, sp, mode);
                    return (
                      <span className="pf-ln__sp" key={sp} data-status={c?.status ?? "none"}>
                        {c ? <Glyph status={c.status} size={16} /> : <span className="pf-ln__none">—</span>}
                      </span>
                    );
                  })}
                </button>
              );
            })}
          </div>
          {u ? (
            <div
              className={`pf-stage${stageKey ? " is-in" : ""}`}
              key={`${u.id}-${stageKey}`}
              ref={stageRef}
              style={css({ "--lane-color": laneOf(u.id) })}
              aria-live={rot.live}
            >
              <div className="pf-stage__no num" aria-hidden="true">
                {pad2(i + 1)}
              </div>
              <div className="pf-stage__art">
                <LaneArt id={u.id} name={u.name} live={!reduced} />
              </div>
              <p className="eyebrow pf-stage__eyebrow">
                <i>Lane {pad2(i + 1)}</i> · {FMT_WORD[u.default_format] ?? u.default_format} · needs{" "}
                {u.requires.kinds.map((k) => kindLong(k).toLowerCase()).join(" + ")}
              </p>
              <div className="pf-stage__text">
                <h3 className="pf-stage__name">
                  <span>{l1}</span>
                  {l2 ? <span>{l2}</span> : null}
                </h3>
                <p className="pf-stage__blurb">
                  {u.notes ? `${u.notes}. ` : ""}
                  {u.duration_s.min}–{u.duration_s.max} s ·{" "}
                  {built ? `composition ${u.composition} built` : u.composition ? `composition ${u.composition} not built yet` : "no composition yet"}
                </p>
                <div className="pf-stage__cta">
                  <button type="button" className="btn btn--primary" onClick={() => open(i, null)}>
                    Open this lane <Arrow />
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}
      <div className="pf-strip__foot">
        <span>{MODE_LABEL[mode]} mode today:</span>
        {STATUS_ORDER.map((k) => (
          <span className={`pf-count${n[k] ? "" : " is-zero"}`} key={k}>
            <StatusChip status={k} size={14} label={`${n[k]} ${STATUS_WORD[k]}`} />
          </span>
        ))}
        <span>
          {go.length
            ? `Go means data across the line and a built composition: ${go.map((c) => `${usecases.find((x) => x.id === c.usecase)?.name ?? c.usecase} × ${c.sport}`).join(", ")}.`
            : "Nothing is Go in this mode: no cell has both cleared data and a built composition."}
        </span>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ 3 + 4 · a lane opened into its scene

function LaneScene({
  uc,
  index,
  usecases,
  cells,
  sources,
  sport,
  mode,
  reduced,
  go,
  setMode,
}: {
  uc: UseCase;
  index: number;
  usecases: UseCase[];
  cells: HeatmapCell[];
  sources: Source[];
  sport: Sport | null;
  mode: Mode;
  reduced: boolean;
  go: (s: FrontSearch) => void;
  setMode: (m: Mode) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const [sweep, setSweep] = useState(0);
  const create = useCreateProject();
  const detail = !!sport;
  const color = laneOf(uc.id);

  // open: clip from the chosen row to the full screen, then the hairline sweeps
  useLayoutEffect(() => {
    const el = root.current;
    document.documentElement.style.overflow = "hidden";
    const r = openFrom;
    openFrom = null;
    if (el && r && !reduced && r.bottom > 0 && r.top < window.innerHeight) {
      el.style.transition = "none";
      el.style.clipPath = `inset(${Math.max(0, r.top)}px 0 ${Math.max(0, window.innerHeight - r.bottom)}px 0)`;
      void el.offsetWidth;
      el.style.transition = "clip-path var(--motion-wipe) var(--ease-wipe)";
      el.style.clipPath = "inset(0 0 0 0)";
    }
    back.current?.focus({ preventScroll: true });
    // aria-modal alone does not stop the page behind from being tabbed to or clicked
    const restore = el ? inertOutside(el) : () => {};
    return () => {
      restore();
      document.documentElement.style.overflow = "";
    };
  }, [reduced]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: sweep again whenever the lane changes
  useEffect(() => {
    setSweep((s) => s + 1);
    root.current?.scrollTo({ top: 0 });
  }, [uc.id]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refocus on every level change
  useEffect(() => {
    back.current?.focus({ preventScroll: true });
  }, [detail]);

  const close = useCallback(() => {
    const el = root.current;
    const row = document.querySelectorAll<HTMLElement>(".pf-ln")[index] ?? null;
    const finish = () => {
      go({ mode });
      window.setTimeout(() => row?.focus({ preventScroll: true }), 0);
    };
    const r = row?.getBoundingClientRect();
    if (el && r && !reduced && r.bottom > 0 && r.top < window.innerHeight) {
      el.style.transition = "clip-path var(--motion-base) var(--ease-wipe)";
      el.style.clipPath = `inset(${Math.max(0, r.top)}px 0 ${Math.max(0, window.innerHeight - r.bottom)}px 0)`;
      window.setTimeout(finish, 380);
    } else finish();
  }, [go, index, mode, reduced]);
  const up = useCallback(() => (sport ? go({ format: uc.id, mode }) : close()), [sport, go, uc.id, mode, close]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        up();
      } else if (e.key === "Tab" && root.current) {
        const f = [...root.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), [tabindex='0']")].filter(
          (n) => n.offsetParent !== null && n.tabIndex >= 0,
        );
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) {
          e.preventDefault();
          f[f.length - 1]?.focus();
        } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
          e.preventDefault();
          f[0]?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [up]);

  const prev = usecases[(index - 1 + usecases.length) % usecases.length];
  const next = usecases[(index + 1) % usecases.length];
  const built = cells.some((c) => c.usecase === uc.id && c.composition_implemented);
  const cell = sport ? cellOf(cells, uc.id, sport, mode) : undefined;
  const never = sport ? neverFetchedFor(sources, sport, uc.requires.kinds) : [];

  return (
    <div
      className={`pf-scene${detail ? " is-detail" : ""}`}
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-labelledby="pf-scene-title"
      style={css({ "--lane-color": color })}
    >
      <div className="pf-scene__tint" aria-hidden="true" />
      <div className="pf-scene__streaks" aria-hidden="true">
        <i style={css({ "--y": "21vh", "--h": "1.2vh", "--t": "13s", "--dl": "-2s" })} />
        <i style={css({ "--y": "44vh", "--h": "3vh", "--t": "19s", "--dl": "-9s" })} />
        <i style={css({ "--y": "69vh", "--h": ".7vh", "--t": "11s", "--dl": "-5s" })} />
        <i style={css({ "--y": "86vh", "--h": "2vh", "--t": "23s", "--dl": "-14s" })} />
      </div>
      {!reduced ? <div className="pf-scene__sweep" key={sweep} aria-hidden="true" /> : null}
      <header className="pf-scene__bar">
        <button
          type="button"
          className="btn btn--ghost"
          ref={back}
          onClick={up}
          aria-label={sport ? `Back to ${uc.name}` : "Back to the lanes"}
        >
          <Arrow dir="left" /> {sport ? `Lane ${pad2(index + 1)}` : "The lanes"} <kbd>Esc</kbd>
        </button>
        <nav className="pf-crumbs" aria-label="Where you are">
          <button type="button" onClick={close}>
            StatReel
          </button>
          <span className="pf-crumbs__sep" />
          {sport ? (
            <>
              <button type="button" onClick={() => go({ format: uc.id, mode })}>
                {uc.name}
              </button>
              <span className="pf-crumbs__sep" />
              <span aria-current="true">{sport}</span>
            </>
          ) : (
            <span aria-current="true">{uc.name}</span>
          )}
        </nav>
        <div className="pf-scene__right">
          <span className="pf-scene__step">
            {prev ? (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                aria-label={`Previous lane: ${prev.name}`}
                onClick={() => go({ format: prev.id, mode })}
              >
                <Arrow dir="left" />
              </button>
            ) : null}
            <span className="num">
              {pad2(index + 1)} / {pad2(usecases.length)}
            </span>
            {next ? (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                aria-label={`Next lane: ${next.name}`}
                onClick={() => go({ format: next.id, mode })}
              >
                <Arrow />
              </button>
            ) : null}
          </span>
          <ModeSwitch mode={mode} onChange={setMode} label="Line at" />
        </div>
      </header>
      <div className="pf-scene__body">
        <figure className="pf-scene__art">
          <div className="pf-scene__no num" aria-hidden="true">
            {pad2(index + 1)}
          </div>
          <LaneArt id={uc.id} name={uc.name} live={!reduced} />
          <figcaption>Stylised illustration, not a frame from a real video</figcaption>
        </figure>
        <div className="pf-scene__info">
          <p className="eyebrow">
            <i>
              Lane {pad2(index + 1)} of {pad2(usecases.length)}
            </i>{" "}
            · {sport ? "finish picture" : "the scene"}
          </p>
          <h2 id="pf-scene-title">{uc.name}</h2>
          {!sport ? (
            <div className="pf-l3">
              <p className="pf-l3__blurb">
                {uc.notes ? `${uc.notes}.` : "No description in the use-case registry."}
              </p>
              <dl className="pf-facts">
                <dt>Needs</dt>
                <dd>
                  {uc.requires.kinds.map((k) => (
                    <span key={k} className="pf-facts__k">
                      {kindLong(k)} <span className="tag">{k}</span>
                    </span>
                  ))}
                  {uc.requires.min_seasons ? ` · at least ${uc.requires.min_seasons} seasons` : ""}
                </dd>
                <dt>Format</dt>
                <dd>
                  <FormatIcon format={uc.default_format} /> {FMT_WORD[uc.default_format] ?? uc.default_format} by default
                  · {uc.duration_s.min}–{uc.duration_s.max} s
                </dd>
                <dt>Composition</dt>
                <dd>
                  {uc.composition ? (
                    <>
                      <span className={`tag${built ? "" : " tag--ghost"}`}>{built ? "built" : "not built"}</span>{" "}
                      {uc.composition}
                    </>
                  ) : (
                    "Not designed yet"
                  )}{" "}
                  · complexity stage {uc.stage}
                </dd>
              </dl>
              <div className="pf-fl-head">
                <h3>Four finish lines</h3>
                <span className="eyebrow">where this lane stands · {MODE_LABEL[mode].toLowerCase()}</span>
              </div>
              {SPORTS.map((sp) => {
                const c = cellOf(cells, uc.id, sp, mode);
                return (
                  <button
                    type="button"
                    key={sp}
                    className="pf-fl"
                    data-status={c?.status ?? "none"}
                    aria-label={`${sp}: ${c ? STATUS_WORD[c.status] : "no cell"}. Open the finish picture.`}
                    onClick={() => go({ format: uc.id, sport: sp, mode })}
                  >
                    <span className="pf-fl__sport">{sp}</span>
                    <span className="pf-fl__track">
                      {c ? <LaneBar cell={c} status={c.status} /> : <span className="pf-fl__none">no heatmap cell</span>}
                    </span>
                    <span className="pf-fl__status">
                      {c ? STATUS_WORD[c.status] : "—"}
                      {c ? <small>{STATUS_AIR[c.status]}</small> : null}
                    </span>
                    <Arrow />
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="pf-l4">
              {/* a group of pressed buttons, like the heatmap layer's sport switch: each press navigates, so
                  there is no tab panel or arrow-key roving for a tablist to promise */}
              <fieldset className="pf-tabs">
                <legend className="sr-only">Sport</legend>
                {SPORTS.map((sp) => {
                  const c = cellOf(cells, uc.id, sp, mode);
                  return (
                    <button
                      type="button"
                      key={sp}
                      className="pf-tab"
                      data-status={c?.status ?? "none"}
                      aria-pressed={sp === sport}
                      onClick={() => go({ format: uc.id, sport: sp, mode })}
                    >
                      {sp}
                      {c ? <Glyph status={c.status} size={14} /> : null}
                      <span className="sr-only">{c ? STATUS_WORD[c.status] : "no cell"}</span>
                    </button>
                  );
                })}
              </fieldset>
              {cell ? (
                <>
                  <div className="pf-l4__head">
                    <StatusChip status={cell.status} size={18} />
                    <span className="pf-l4__when">today · {MODE_LABEL[mode].toLowerCase()}</span>
                  </div>
                  <p className="pf-l4__reason">
                    <strong>Reason, verbatim:</strong> {cell.reason}
                  </p>
                  <FinishPicture cell={cell} sources={sources} />
                  <div className="pf-l4__foot">
                    <div>
                      <h4 className="eyebrow">Did not start · off-limits, never fetched</h4>
                      <DnsList sources={never} empty={`No off-limits source is registered for ${sport} on these kinds.`} />
                    </div>
                    <div className="pf-l4__actions">
                      {cell.status === "ask" || cell.status === "blocked" ? (
                        // the same warning the heatmap layer shows above its Create project (HeatmapCell.tsx)
                        <p className="pf-l4__err">
                          You can draft it, but the gate refuses a {MODE_LABEL[mode].toLowerCase()} publish until every
                          required kind clears.
                        </p>
                      ) : null}
                      <Link
                        className="btn btn--primary"
                        to="/heatmap/$usecase/$sport"
                        params={{ usecase: uc.id, sport: sport as string }}
                        search={{ mode }}
                      >
                        Open in the heatmap <Arrow />
                      </Link>
                      <button
                        type="button"
                        className="btn"
                        disabled={create.isPending}
                        onClick={() => create.mutate({ usecase: uc, sport: sport as Sport, mode })}
                      >
                        {create.isPending ? "Creating" : "Create project"} <Arrow />
                      </button>
                      {create.isError ? (
                        <p className="pf-l4__err" role="alert">
                          Could not create the project: {serverError(create.error)}
                        </p>
                      ) : null}
                      <p>
                        Creating a project opens it in the studio, where the co-pilot drafts it. The gate still judges
                        every render.
                      </p>
                    </div>
                  </div>
                </>
              ) : (
                <p className="pf-l4__reason">No heatmap cell for {sport} in this mode yet (recompute the heatmap).</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ 5 · the line

function TheLine({
  sources,
  mode,
  setMode,
  loading,
  error,
  onRetry,
  retrying,
}: {
  sources: Source[];
  mode: Mode;
  setMode: (m: Mode) => void;
  loading: boolean;
  /** why the registry did not load (loadCause), null when it did */
  error: string | null;
  onRetry: () => void;
  retrying: boolean;
}) {
  const v = verdictCounts(sources);
  const across = acrossCount(sources, mode);
  const shown = useCountUp(across);
  const grid = registryGrid(sources);
  const TALLY: [keyof typeof v, string][] = [
    ["legal", "monetized OK"],
    ["non_commercial", "non-commercial"],
    ["paid", "paid, not bought"],
    ["avoid", "never start"],
  ];
  return (
    <section className="pf-line deco-grain" id="pf-line" aria-labelledby="pf-line-h">
      <div className="pf-line__copy">
        <p className="eyebrow">The licence line · computed from the registry</p>
        <h2 id="pf-line-h">
          One line. <em>Everything is judged by where it stands to it.</em>
        </h2>
        <div className="pf-across" aria-live="polite">
          <span className="pf-across__n num">{loading || error ? "—" : shown}</span>
          <span className="pf-across__of num">/ {sources.length || "—"}</span>
          <span className="pf-across__cap">
            sources across
            <br />
            the line, {MODE_LABEL[mode].toLowerCase()}
          </span>
        </div>
        <p className="pf-lead">
          A photo-finish camera does not record a picture. It records what crossed one line, and when. StatReel draws
          one line for data, and the mode switch moves it.
        </p>
        <div className="pf-line__seg">
          <ModeSwitch mode={mode} onChange={setMode} label="Line at" />
        </div>
        <ul className="pf-trust">
          <li>
            <svg viewBox="0 0 32 32" aria-hidden="true">
              <path d="M4 9h10M4 16h16M4 23h10" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="M22 3v26" stroke="var(--color-signal)" strokeWidth="2" />
              <circle cx="26" cy="16" r="3" fill="currentColor" />
            </svg>
            <span>
              <b>Licence lineage on every video</b>Each required data kind names its source and its licence class, all
              the way to the gate.
            </span>
          </li>
          <li>
            <svg viewBox="0 0 32 32" aria-hidden="true">
              <path d="M5 6v20M27 6v20M5 10h22M5 22h22" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="M11 12l10 8M21 12l-10 8" stroke="currentColor" strokeWidth="2" />
            </svg>
            <span>
              <b>A gate that refuses</b>A monetized video built on non-commercial data does not publish. It stops short
              of the line and says why.
            </span>
          </li>
          <li>
            <svg viewBox="0 0 32 32" aria-hidden="true">
              <rect x="5" y="5" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="3 3" />
              <path d="M10 21l5-7 4 4 3-4" fill="none" stroke="currentColor" strokeWidth="2" />
            </svg>
            <span>
              <b>No borrowed logos</b>No league, team, sponsor or broadcaster marks, and no athlete photos. Type, line
              and number only.
            </span>
          </li>
        </ul>
      </div>
      <div className="pf-line__pic">
        {error ? (
          <div className="empty">
            <b>Registry did not load</b>The registry picture cannot be drawn ({error}).{" "}
            <RetryButton onRetry={onRetry} busy={retrying} />
          </div>
        ) : loading ? (
          <p className="pf-lanes__msg">Reading the registry.</p>
        ) : (
          <>
            <div className="pf-tally">
              {TALLY.map(([k, word]) => (
                <div key={k}>
                  <b className="num">{v[k]}</b>
                  <span className={`src-chip src-chip--${k}`}>
                    <i className="src-chip__m" aria-hidden="true" />
                    {word}
                  </span>
                </div>
              ))}
            </div>
            <div
              className="fp pf-reg"
              data-mode={mode}
              style={css({ "--fp-share": registryShare(mode).toFixed(4) })}
            >
              <div className="fp-head" aria-hidden="true">
                <span>Sport</span>
                <span>Never start</span>
                <span>Paid</span>
                <span>Non-commercial</span>
                <span>Legal</span>
              </div>
              <div className="fp-lanes" role="table" aria-label={`Registry by sport and licence verdict, line at ${MODE_LABEL[mode]}`}>
                <div className="fp-short" aria-hidden="true" />
                {grid.map((g) => (
                  <div className="fp-lane" role="row" key={g.group}>
                    <div className="fp-kind" role="rowheader">
                      <b>{g.group === "all" ? "All" : g.group}</b>
                      <code className="num">
                        {g.total} source{g.total === 1 ? "" : "s"}
                      </code>
                    </div>
                    {REG_CLASSES.map((cls) => (
                      <div className={`fp-cell${cls === "avoid" ? " fp-cell--dns" : ""}`} role="cell" key={cls}>
                        <span className="sr-only">{LICENCE_WORD[cls]}:</span>
                        {g.cells[cls].map((s) => (
                          <SourceChip
                            key={s.id}
                            id={s.id}
                            cls={cls}
                            short={cls === "avoid" || cls === "paid" || (mode === "monetized" && cls === "non_commercial")}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                ))}
                <div className="fp-line" aria-hidden="true">
                  <span className="fp-line-tag">Licence line · {MODE_LABEL[mode].toLowerCase()}</span>
                </div>
              </div>
            </div>
            <div className="pf-reg-list">
              {(["legal", "non_commercial", "paid", "avoid"] as const).map((cls) => (
                <p key={cls}>
                  <b>
                    {cls === "avoid" ? "Never start" : LICENCE_WORD[cls]} ({v[cls]}):
                  </b>{" "}
                  {sources
                    .filter((s) => s.verdict === cls)
                    .map((s) => s.id)
                    .join(", ") || "none"}
                </p>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function useCountUp(to: number, ms = 700): number {
  const reduced = useReducedMotion();
  const [v, setV] = useState(to);
  const from = useRef(to);
  useEffect(() => {
    if (reduced || from.current === to) {
      from.current = to;
      setV(to);
      return;
    }
    const a = from.current;
    from.current = to;
    let raf = 0;
    let t0: number | null = null;
    const step = (ts: number) => {
      if (t0 === null) t0 = ts;
      const p = Math.min(1, (ts - t0) / ms);
      setV(Math.round(a + (to - a) * (1 - (1 - p) ** 3)));
      if (p < 1) raf = window.requestAnimationFrame(step);
    };
    raf = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(raf);
  }, [to, ms, reduced]);
  return v;
}

// ------------------------------------------------------------------ 6 · the first short

function usePlayerTime(ref: RefObject<PlayerRef | null>, meta: PlayerMeta | null): number {
  const [f, setF] = useState(0);
  useEffect(() => {
    const p = ref.current;
    if (!p || !meta) return;
    let last = 0;
    const h = (e: { detail: { frame: number } }) => {
      const now = performance.now();
      if (now - last < 120) return; // the strip needs ~8 updates a second, not 30
      last = now;
      setF(e.detail.frame);
    };
    p.addEventListener("frameupdate", h);
    p.addEventListener("seeked", h);
    return () => {
      p.removeEventListener("frameupdate", h);
      p.removeEventListener("seeked", h);
    };
  }, [ref, meta]);
  return meta ? f / meta.fps : 0;
}

function FirstShort({
  detail,
  loading,
  error,
  onRetry,
  retrying,
  usecases,
  reduced,
}: {
  detail: ProjectDetail | null;
  loading: boolean;
  /** why the rundown did not load (loadCause), null when it did */
  error: string | null;
  onRetry: () => void;
  retrying: boolean;
  usecases: UseCase[];
  reduced: boolean;
}) {
  const props: EraAdjustedProps | null = detail?.props?.props ?? null;
  const playerRef = useRef<PlayerRef>(null);
  const [meta, setMeta] = useState<PlayerMeta | null>(null);
  const onMeta = useCallback(
    (m: PlayerMeta | null) => {
      setMeta(m);
      if (m && reduced) window.setTimeout(() => playerRef.current?.seekTo(Math.floor(m.durationInFrames * 0.72)), 50);
    },
    [reduced],
  );
  const t = usePlayerTime(playerRef, meta);
  const format = props?.format ?? "vertical";
  const hero = useMemo(() => (props ? biggestMovers(props.rows, 1)[0] : undefined), [props]);
  const hook = props?.scenes.find((s) => s.kind === "hook")?.on_screen ?? props?.title ?? "";
  const [a, b] = splitNeq(hook);
  const strip = props ? sceneStrip(props.scenes, props.timing, meta ? meta.durationInFrames / meta.fps : 0) : null;
  const render = latestRender(detail);
  const policy = renderPolicy(render);
  const uc = usecases.find((u) => u.id === detail?.project.use_case_id);
  const seek = (s: number) => {
    if (!meta) return;
    playerRef.current?.seekTo(Math.max(0, Math.min(meta.durationInFrames - 1, Math.round(s * meta.fps))));
  };

  return (
    <section className="pf-short" id="pf-short" aria-labelledby="pf-short-h">
      <figure className={`pf-short__frame${format === "landscape" ? " is-wide" : ""}`}>
        <div className="pf-short__screen">
          <Programme
            props={props}
            format={format}
            playerRef={playerRef}
            onMeta={onMeta}
            autoPlay={!reduced}
            loop
            muted
            compositionName={uc?.composition}
            slate={
              <Slate
                title={loading ? "Tuning in" : "No short yet"}
                lines={
                  <p>
                    {error ? (
                      <>
                        The rundown did not load ({error}), so there is no short to play.{" "}
                        <RetryButton onRetry={onRetry} busy={retrying} />
                      </>
                    ) : (
                      "No project has props yet: create one from a Go cell and draft it with the co-pilot."
                    )}
                  </p>
                }
              />
            }
          />
        </div>
        <figcaption className="pf-short__cap">
          <span>{props?.attribution ?? "no attribution: nothing drafted yet"}</span>
          <span>
            {props ? (props.timing ? "real props · produced timing" : "real props · draft, no audio") : "slate"} ·{" "}
            {formatLabel(format)}
          </span>
        </figcaption>
      </figure>
      <div className="pf-short__text">
        <p className="eyebrow">
          {detail
            ? `The newest short · ${detail.project.id} · props v${detail.props?.version ?? "?"} by ${detail.props?.created_by ?? "?"}`
            : "The first short"}
        </p>
        <h2 id="pf-short-h" className={props && hook.length > 30 ? "is-long" : ""}>
          {props ? (
            b !== null ? (
              <>
                <em>{a}</em>
                <NotEqual /> {b}
              </>
            ) : (
              <em>{a}</em>
            )
          ) : (
            <>
              <em>Nothing</em> on the line yet
            </>
          )}
        </h2>
        {props && hero ? (
          <div className="pf-jump">
            <b className="num">{hero.raw_rank}</b>
            <svg viewBox="0 0 60 24" aria-hidden="true">
              <path d="M0 12h56M46 3l10 9-10 9" fill="none" stroke="currentColor" strokeWidth="2.5" />
            </svg>
            <i className="num">{hero.adjusted_rank}</i>
            <span>
              {hero.name}
              <br />
              {props.metric_raw_label.toLowerCase()} rank to
              <br />
              {props.metric_adjusted_label.toLowerCase()} rank
            </span>
          </div>
        ) : null}
        <p>
          {props ? (
            <>
              {uc?.composition ?? "The composition"} as a slopegraph: <strong className="num">{props.rows.length}</strong>{" "}
              rows ranked by {props.metric_raw_label.toLowerCase()}, then by {props.metric_adjusted_label.toLowerCase()}.{" "}
              {strip ? (
                <>
                  <strong className="num">{fmtDuration(strip.duration)}</strong>
                  {strip.measured ? " measured" : " draft length"},{" "}
                </>
              ) : null}
              <strong className="num">{props.scenes.length}</strong> scenes
              {props.timing ? ", captions burned in." : "; captions and audio arrive with Produce."}
            </>
          ) : loading ? (
            "Reading the newest project."
          ) : (
            "When a project has props, its short plays here through the real composition, with its real lineage."
          )}
        </p>
        {strip && strip.scenes.length ? (
          <div className="pf-scenes">
            <div className="pf-scenes__row">
              {strip.scenes.map((s) => {
                const on = t >= s.start && t < s.end;
                return (
                  <button
                    type="button"
                    key={s.id}
                    className={on ? "on" : ""}
                    style={css({ left: `${(s.start / strip.duration) * 100}%`, width: `${((s.end - s.start) / strip.duration) * 100}%` })}
                    onClick={() => seek(s.start)}
                    aria-label={`Seek to scene ${s.label}`}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
            <i className="pf-scenes__head" style={css({ left: `${Math.min(100, (t / strip.duration) * 100)}%` })} aria-hidden="true" />
            <span className="pf-scenes__note">
              {strip.measured ? "scenes in voice time" : "scenes split evenly until Produce measures the voice"}
            </span>
          </div>
        ) : null}
        {props ? (
          <p className="pf-attr">
            {props.attribution}
            {policy ? ` · gate ${policy.allow ? "allows" : "refuses"}` : " · not gated yet"}
          </p>
        ) : null}
        <div className="pf-short__actions">
          {detail ? (
            <>
              <Link className="btn btn--primary" to="/studio/$projectId" params={{ projectId: detail.project.id }}>
                Open it in the studio
              </Link>
              <Link
                className="btn"
                to="/heatmap/$usecase/$sport"
                params={{ usecase: detail.project.use_case_id, sport: detail.project.sport }}
                search={{ mode: detail.project.mode === "non_commercial" ? "non_commercial" : "monetized" }}
              >
                See its lane on the heatmap
              </Link>
            </>
          ) : (
            <Link className="btn btn--primary" to="/heatmap" search={{ mode: "monetized", view: "feasibility" }}>
              Find a Go cell
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
