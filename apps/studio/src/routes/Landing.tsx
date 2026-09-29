/** Front panel (A/3 index): proposition, owner fast lane, input patch matrix, licence gate, output. */
import type { Mode, Source } from "@statreel/schemas";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, type ProjectWithJobs, qk } from "../api";
import { FormatGlyph, Jack, JackSvg, KindPin, Led, Screws } from "../components/glyphs";
import { PlayerStage } from "../components/PlayerStage";
import { ErrorState } from "../components/ui";
import {
  busState,
  type Capability,
  CELL_STATUSES,
  cellOf,
  countStatuses,
  KIND_NAMES,
  KINDS,
  LICENCE_RANK,
  MODE_LABEL,
  needsYou,
  SPORTS,
  STAGE_LABEL,
  STATUS_META,
} from "../logic";

const GROUPS = ["F1", "NBA", "NHL", "Soccer", "all"] as const;

/** Most recent activity: newest of created_at and the latest job. */
const activity = (p: ProjectWithJobs) => [p.created_at, p.jobs[0]?.created_at ?? ""].sort().at(-1) ?? p.created_at;

type PinKind = "legal" | "nc" | "paid" | "part" | "avoid" | null;

function pinFor(s: Source, kind: string): PinKind {
  const declared = (s.kinds as string[]).includes(kind);
  const partial = ((s.partial_kinds ?? []) as string[]).includes(kind);
  if (s.verdict === "avoid") return declared ? "avoid" : null;
  if (declared) return s.verdict === "legal" ? "legal" : s.verdict === "non_commercial" ? "nc" : "paid";
  if (partial) return "part";
  return null;
}

function testedState(caps: Capability[], sourceId: string, kind: string): "pass" | "fail" | "untested" {
  const c = caps.filter((x) => x.source_id === sourceId && x.kind === kind);
  if (!c.length) return "untested";
  return c.some((x) => x.status === "pass") ? "pass" : "fail";
}

export function LandingPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("monetized");
  const heat = useQuery({ queryKey: qk.heatmap, queryFn: api.heatmap });
  const src = useQuery({ queryKey: qk.sources, queryFn: api.sources });
  const projects = useQuery({ queryKey: qk.projects, queryFn: api.projects });

  const list = useMemo(
    () => [...(projects.data?.projects ?? [])].sort((a, b) => activity(b).localeCompare(activity(a))),
    [projects.data],
  );
  const latest = list[0];
  const resume = list.find((p) => p.status !== "published") ?? latest;
  const detail = useQuery({
    queryKey: qk.project(latest?.id ?? "-"),
    queryFn: () => api.project(latest!.id),
    enabled: !!latest,
  });

  const cells = heat.data?.cells ?? [];
  const usecases = heat.data?.usecases ?? [];
  const counts = countStatuses(cells, mode);
  const total = cells.filter((c) => c.mode === mode).length;
  const sources = useMemo(() => src.data?.sources ?? [], [src.data]);
  const caps = useMemo(() => src.data?.capabilities ?? [], [src.data]);
  const need = list.filter((p) => needsYou(p.status, p.jobs[0])).length;

  const cols = useMemo(
    () =>
      GROUPS.flatMap((g) =>
        sources
          .filter((s) => s.sport === g)
          .sort((a, b) => (LICENCE_RANK[a.verdict] ?? 9) - (LICENCE_RANK[b.verdict] ?? 9)),
      ),
    [sources],
  );
  const busCount = (kind: string) =>
    SPORTS.filter((sp) => busState(caps, sources, kind, sp, mode).state === "ok").length;
  const latestUc = usecases.find((u) => u.id === latest?.use_case_id);
  const latestKinds = new Set<string>(latestUc?.requires.kinds ?? []);
  const ncPins = cols.reduce((n, s) => n + KINDS.filter((k) => pinFor(s, k) === "nc").length, 0);

  // keys 1 / 2 / 3
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "1") void navigate({ to: "/heatmap", search: { mode } });
      if (e.key === "2") void navigate({ to: "/projects" });
      if (e.key === "3" && resume) void navigate({ to: "/studio/$projectId", params: { projectId: resume.id } });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, mode, resume]);

  // ---- cables (desktop only)
  const instRef = useRef<HTMLDivElement>(null);
  const [cables, setCables] = useState<{ d: string; cls: string; sx?: number; sy?: number }[]>([]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: busCount/latestKinds derive from the listed data
  const draw = useCallback(() => {
    const inst = instRef.current;
    if (!inst || window.innerWidth <= 860) return setCables((prev) => (prev.length ? [] : prev));
    const box = inst.getBoundingClientRect();
    const c = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top };
    };
    const path = (a: { x: number; y: number }, b: { x: number; y: number }) => {
      const span = Math.abs(b.x - a.x);
      const dx = Math.max(6, span * 0.45);
      const sag = Math.min(18, 4 + span * 0.12) + Math.abs(b.y - a.y) * 0.18;
      return `M${a.x} ${a.y} C${a.x + dx} ${a.y + sag} ${b.x - dx} ${b.y + sag} ${b.x} ${b.y}`;
    };
    const out: { d: string; cls: string; sx?: number; sy?: number }[] = [];
    const gateEl = inst.querySelector("#gate");
    const gateLeft = gateEl ? gateEl.getBoundingClientRect().left - box.left - 16 : 0;
    for (const k of KINDS) {
      const a = c(inst.querySelector(`[data-jo="${k}"]`));
      if (!a || !gateEl) continue;
      const n = busCount(k);
      const b = { x: gateLeft, y: a.y };
      out.push({
        d: path(a, b),
        cls: n === 0 ? "dead" : latestKinds.has(k) ? "live accent" : "live legal",
        sx: b.x,
        sy: b.y,
      });
    }
    const go = c(inst.querySelector("[data-gate-out]"));
    const oi = c(inst.querySelector("[data-out-in]"));
    if (go && oi) out.push({ d: path(go, oi), cls: latest ? "live accent thick" : "dead" });
    setCables((prev) => (JSON.stringify(prev) === JSON.stringify(out) ? prev : out));
  }, [caps, sources, mode, latest, latestUc]);
  useLayoutEffect(() => {
    draw();
    const ro = new ResizeObserver(() => draw());
    if (instRef.current) ro.observe(instRef.current);
    window.addEventListener("resize", draw);
    void document.fonts?.ready.then(draw);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", draw);
    };
  }, [draw]);

  const props = detail.data?.props?.props ?? null;
  const fmt = (props?.format ?? (latest?.format === "landscape" ? "landscape" : "vertical")) as
    | "vertical"
    | "landscape";

  return (
    <main id="main" className="page wrap landing">
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-head">
          <div>
            <p className="model-line">
              <span className="legend">Model SR-1 · Sports data to video · Local-first</span>
              <span className="ticks" aria-hidden="true" />
            </p>
            <h1 className="hero-title" id="hero-title">
              Sports data,
              <br />
              patched <span className="lit">honestly</span>
            </h1>
            <p className="standfirst">
              StatReel turns licensed <strong>F1, NBA, NHL and soccer</strong> data into{" "}
              <strong>narrated, captioned data-viz videos</strong>, and every video carries its licence lineage from
              input jack to screen.
            </p>
          </div>
          <nav className="fast" aria-label="Owner fast lane">
            <div className="legend fast-legend">
              <span>Owner fast lane</span>
              <span className="silk-muted">keys 1 · 2 · 3</span>
            </div>
            <Link className="bigkey" to="/heatmap" search={{ mode }} data-testid="open-heatmap">
              <span className="k-idx">1</span>
              <span>
                <span className="k-main">Open heatmap</span>
                <span className="k-sub">
                  {heat.data
                    ? `${counts.go} go · ${counts["data-ready"]} ready · ${counts.ask} ask · ${counts.blocked} blocked · ${MODE_LABEL[mode].toLowerCase()}`
                    : heat.isError
                      ? "heatmap unavailable"
                      : "reading heatmap…"}
                </span>
              </span>
              <span className="k-read">{heat.data ? counts.go + counts["data-ready"] : "—"}</span>
            </Link>
            <Link className="bigkey" to="/projects" data-testid="open-studio">
              <span className="k-idx">2</span>
              <span>
                <span className="k-main">Open studio</span>
                <span className="k-sub">
                  {projects.data
                    ? `${list.length} project${list.length === 1 ? "" : "s"} · ${need} need you`
                    : projects.isError
                      ? "projects unavailable"
                      : "reading projects…"}
                </span>
              </span>
              <span className="k-read">{projects.data ? list.length : "—"}</span>
            </Link>
            {resume ? (
              <Link
                className="bigkey primary"
                to="/studio/$projectId"
                params={{ projectId: resume.id }}
                data-testid="resume-last"
              >
                <span className="k-idx">3</span>
                <span>
                  <span className="k-main">Resume last video</span>
                  <span className="k-sub">
                    {resume.title} · {STAGE_LABEL[resume.status] ?? resume.status}
                  </span>
                </span>
                <span className="k-play" aria-hidden="true">
                  ▶
                </span>
              </Link>
            ) : (
              <button type="button" className="bigkey primary" disabled data-testid="resume-last">
                <span className="k-idx">3</span>
                <span>
                  <span className="k-main">Resume last video</span>
                  <span className="k-sub">No project yet: start one from a GO cell on the heatmap.</span>
                </span>
                <span className="k-play" aria-hidden="true">
                  ▶
                </span>
              </button>
            )}
          </nav>
        </div>

        {heat.isError && src.isError ? <ErrorState error={heat.error} what="Heatmap and registry" /> : null}

        <div className="instrument module" ref={instRef}>
          <Screws />
          <svg className="cables" aria-hidden="true">
            {cables.map((c, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: cables are positional
              <g key={i}>
                <path d={c.d} className="cable shadow" transform="translate(0 2)" />
                <path d={c.d} className={`cable ${c.cls}`} />
                {c.sx !== undefined && c.sy !== undefined ? (
                  <circle cx={c.sx} cy={c.sy} r="5.5" className="cable-socket" />
                ) : null}
              </g>
            ))}
          </svg>

          <div className="sub" id="patch">
            <div className="sub-head">
              <h2>Input patch matrix</h2>
              <span className="mono">
                {cols.length} jacks × {KINDS.length} kind buses · {caps.length} capability test
                {caps.length === 1 ? "" : "s"} on record
              </span>
            </div>
            <div className="pm-scroll">
              {sources.length ? (
                <div
                  className="pm"
                  style={{ gridTemplateColumns: `78px repeat(${cols.length}, minmax(15px, 1fr)) 58px` }}
                >
                  <div className="legend pm-corner" style={{ gridRow: 1, gridColumn: 1 }}>
                    Jack ↑
                  </div>
                  {cols.map((s, i) => (
                    <div
                      key={`l-${s.id}`}
                      className={`pm-lab${s.verdict === "avoid" ? " avoid" : ""}`}
                      style={{ gridRow: 1, gridColumn: i + 2 }}
                    >
                      {s.id}
                      {s.verdict === "avoid" ? <span className="sr-only"> (avoid: never fetched)</span> : null}
                    </div>
                  ))}
                  {cols.map((s, i) => (
                    <div
                      key={`c-${s.id}`}
                      className={`pm-cap lic-${s.verdict}`}
                      style={{ gridRow: 2, gridColumn: i + 2 }}
                    >
                      <JackSvg cls={s.verdict} />
                    </div>
                  ))}
                  <div className="legend pm-corner right" style={{ gridRow: 1, gridColumn: cols.length + 2 }}>
                    Sports
                    <br />
                    fed
                  </div>
                  {(() => {
                    let c0 = 2;
                    return GROUPS.map((g) => {
                      const n = cols.filter((s) => s.sport === g).length;
                      const el = n ? (
                        <div
                          key={`g-${g}`}
                          className="pm-group"
                          style={{ gridRow: 3, gridColumn: `${c0} / span ${n}` }}
                        >
                          {g === "all" ? "All" : g}
                        </div>
                      ) : null;
                      c0 += n;
                      return el;
                    });
                  })()}
                  {KINDS.map((k, r) => {
                    const row = r + 4;
                    const n = busCount(k);
                    return [
                      <div key={`b-${k}`} className="pm-bus" style={{ gridRow: row, gridColumn: 1 }}>
                        {k}
                      </div>,
                      ...cols.map((s, i) => {
                        const pin = pinFor(s, k);
                        const t = pin && pin !== "avoid" ? testedState(caps, s.id, k) : "untested";
                        const off = pin === "nc" && mode === "monetized";
                        const label = pin
                          ? `${s.id} · ${k}: ${pin === "avoid" ? "capped, never fetched" : pin === "part" ? "partial" : s.verdict}${pin !== "avoid" ? `, ${t === "pass" ? "tested pass" : t === "fail" ? "tested fail" : "declared, untested"}` : ""}${off ? ", unplugged in monetized mode" : ""}`
                          : `${s.id} · ${k}: none`;
                        return (
                          <div
                            key={`p-${k}-${s.id}`}
                            className={`pm-pin${s.verdict === "avoid" ? " avoidcol" : ""}`}
                            style={{ gridRow: row, gridColumn: i + 2 }}
                            title={label}
                          >
                            {pin ? (
                              <span className={`pin ${pin} ${t}${off ? " off" : ""}`} role="img" aria-label={label} />
                            ) : (
                              <span className="hole" aria-hidden="true" />
                            )}
                          </div>
                        );
                      }),
                      <div key={`r-${k}`} className="pm-read" style={{ gridRow: row, gridColumn: cols.length + 2 }}>
                        <span className="display">
                          <span className="num">{n}</span>
                          <span className="sr-only">{`${KIND_NAMES[k]}: ${n} of 4 sports fed by a tested, allowed source`}</span>
                          <small>/4</small>
                        </span>
                        <span className="jack-out" data-jo={k} aria-hidden="true" />
                      </div>,
                    ];
                  })}
                </div>
              ) : src.isError ? (
                <ErrorState error={src.error} what="Source registry" />
              ) : (
                <div className="display empty">Reading the registry…</div>
              )}
            </div>
            <div className="pm-keyline">
              <span className="k">
                <span className="pin legal pass" aria-hidden="true" />
                legal · tested pass
              </span>
              <span className="k">
                <span className="pin legal untested" aria-hidden="true" />
                hollow = declared, not tested
              </span>
              <span className="k">
                <span className="pin legal fail" aria-hidden="true" />
                barred = tested, failing
              </span>
              <span className="k">
                <span className="pin nc pass" aria-hidden="true" />
                NC collar · non-commercial only
              </span>
              <span className="k">
                <span className="pin paid untested" aria-hidden="true" />
                paid · needs a contract
              </span>
              <span className="k">
                <span className="pin part" aria-hidden="true" />
                partial kind
              </span>
              <span className="k lic-avoid">
                <JackSvg cls="avoid" />
                <span className="keyline-muted">capped · never fetched</span>
              </span>
            </div>
          </div>

          <div className="sub gate-mod" id="gate">
            <div className="sub-head">
              <h2>Licence gate</h2>
            </div>
            <fieldset className="mode-switch" aria-label="Output mode">
              <button
                type="button"
                aria-pressed={mode === "monetized"}
                onClick={() => setMode("monetized")}
                data-testid="front-mode-monetized"
              >
                Monetized<small>legal jacks only</small>
              </button>
              <button
                type="button"
                aria-pressed={mode === "non_commercial"}
                onClick={() => setMode("non_commercial")}
                data-testid="front-mode-non-commercial"
              >
                Non-commercial<small>legal + NC jacks</small>
              </button>
            </fieldset>
            <div className="display gate-read" aria-live="polite">
              <span className="silk">Patchable cells · now</span>
              <div className="gate-big">
                <span className="display-num">{heat.data ? counts.go + counts["data-ready"] : "—"}</span>
                <span className="of">/ {total || "—"}</span>
              </div>
              <div className="gate-rows">
                {CELL_STATUSES.map((s) => [
                  <Led key={`l-${s}`} status={s} />,
                  <span key={`n-${s}`} className="display-num">
                    {heat.data ? counts[s] : "—"}
                  </span>,
                ])}
              </div>
            </div>
            <p className="gate-rule">
              <b>{MODE_LABEL[mode]}</b>:{" "}
              {mode === "monetized"
                ? "only legal jacks may feed the output"
                : "legal and non-commercial jacks may feed the output"}
              .{" "}
              {mode === "monetized" && ncPins
                ? `${ncPins} NC pins are unplugged: their collars do not fit a monetized output. `
                : ""}
              GO needs a tested source and a built composition.
            </p>
            <span className="socket gate-out" data-gate-out aria-hidden="true" />
          </div>

          <div className="sub out-mod" id="out">
            <span className="socket in-socket" data-out-in aria-hidden="true" />
            <div className="sub-head">
              <h2>Output</h2>
              <span className="mono">
                {latest ? `${latest.id} · props v${detail.data?.props?.version ?? "—"}` : "no project"}
              </span>
            </div>
            <div className="out-screen" data-testid="front-player">
              <PlayerStage
                props={props}
                format={fmt}
                autoPlay
                loop
                muted
                compositionName={latestUc?.composition}
                empty={
                  <>
                    <span className="k">output idle</span>
                    <h3>{latest ? "No props yet" : "No video yet"}</h3>
                    <p>
                      {latest
                        ? `${latest.title} has no props. Draft it with the co-pilot in the studio.`
                        : "Create a project from a GO cell on the heatmap; its latest props play here."}
                    </p>
                  </>
                }
              />
            </div>
            <div className="outjacks">
              <span className={fmt === "vertical" ? "on" : ""}>
                <i aria-hidden="true" />
                9:16 short{fmt === "vertical" ? " · on" : ""}
              </span>
              <span className={fmt === "landscape" ? "on" : ""}>
                <i aria-hidden="true" />
                16:9 explainer{fmt === "landscape" ? " · on" : ""}
              </span>
            </div>
            <p className="attr">
              {props ? `${props.attribution} · ${props.method_note}` : "Attribution appears with the first props."}
            </p>
          </div>
        </div>
        <p className="path-caption">
          <span>
            <span className="swatch" aria-hidden="true" />
            The orange cable is the latest project's signal path
            {latestUc
              ? `: ${latestUc.requires.kinds.join(" + ").toUpperCase()} → gate → ${fmt === "vertical" ? "9:16" : "16:9"}`
              : ""}
            .
          </span>
          <span>Bus readouts count only tested, allowed sources; declarations alone never feed a bus.</span>
        </p>
      </section>

      <section className="band" aria-labelledby="presets-title">
        <div className="band-head">
          <div>
            <span className="num-tag">SECTION 02</span>
            <h2 id="presets-title">Presets</h2>
          </div>
          <p>
            The use cases the studio knows. Each declares the data kinds it pins and its default frame; the LEDs show
            whether each sport can feed it in <b>{MODE_LABEL[mode].toLowerCase()}</b> mode right now.
          </p>
        </div>
        <div className="presets">
          {usecases.map((u, i) => (
            <Link key={u.id} className="preset" to="/heatmap" search={{ mode, cell: `${u.id}|F1` }}>
              <span className="p-top">
                <span className="p-id">P{String(i + 1).padStart(2, "0")}</span>
                <FormatGlyph format={u.default_format} />
              </span>
              <h3>{u.name}</h3>
              <span className="pins">
                {u.requires.kinds.map((k) => (
                  <KindPin key={k} kind={k} />
                ))}
              </span>
              <span className="display p-sports">
                {SPORTS.map((s) => {
                  const st = cellOf(cells, u.id, s, mode)?.status ?? "blocked";
                  return (
                    <span key={s}>
                      <Led status={st} hideLabel label={`${s}: ${STATUS_META[st].word}`} />
                      <span className="p-sp">{s === "Soccer" ? "SOC" : s}</span>
                      <span className="p-st">{STATUS_META[st].label}</span>
                    </span>
                  );
                })}
              </span>
              <span className={`comp${u.composition ? " has" : ""}`}>
                {u.composition ? `● ${u.composition}` : "○ composition not designed yet"}
              </span>
            </Link>
          ))}
          {!usecases.length && !heat.isLoading ? <div className="display empty">No use cases loaded.</div> : null}
        </div>
      </section>

      <footer className="foot">
        <span>StatReel · Patchbay</span>
        <span>
          Heatmap basis: {caps.length} capability test{caps.length === 1 ? "" : "s"} on record ·{" "}
          {sources.filter((s) => s.verdict === "avoid").length} sources capped, never fetched
        </span>
        <span>Publishing: private / draft only</span>
        {sources.length ? (
          <span className="foot-jacks">
            <Jack cls="legal" noTag /> legal <Jack cls="non_commercial" noTag /> NC <Jack cls="paid" noTag /> paid{" "}
            <Jack cls="avoid" noTag /> never fetched
          </span>
        ) : null}
      </footer>
    </main>
  );
}
