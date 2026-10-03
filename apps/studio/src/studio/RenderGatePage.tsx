/**
 * 05 Render & gate: live job progress (SSE), the post-render checks against their targets
 * (render checks_json), the video itself (/files), captions and manifest links, the provenance
 * manifest viewer, and the policy verdict with every deny reason verbatim and the checks run.
 */
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Defer } from "../components/arrive";
import { StatusChip } from "../components/glyphs";
import { Empty, Loading } from "../components/ui";
import { latestRender, renderChecks, renderFile, renderPolicy, useManifest } from "../data";
import { checkRows, fileUrl, relTime } from "../logic";
import { hasCaptionSidecar, hasChecks, isNewerRender } from "./render-gate";
import { JobError, JobLine, lastJobOf, produceJob, useStudio, Verdict } from "./shared";

export function RenderGatePage() {
  const { detail, usecase } = useStudio();
  const [pick, setPick] = useState<string | null>(null);
  const renders = detail?.renders ?? [];
  const render = renders.find((r) => r.id === pick) ?? latestRender(detail);
  const manifest = useManifest(render);
  if (!detail) return null;
  const pid = detail.project.id;
  const running = produceJob(detail);
  const policy = renderPolicy(render);
  const checks = renderChecks(render);
  const rows = checks ? checkRows(checks, render?.format ?? detail.project.format, usecase?.duration_s) : [];
  const video = fileUrl(render?.url ?? null);
  const m = manifest.data;
  const newer = isNewerRender(renders, pick);
  const captionsVtt = hasCaptionSidecar(m, "captions.vtt");

  return (
    <div className="rg">
      <div className="rg__bar">
        {running ? (
          <JobLine job={running} projectId={pid} />
        ) : (
          <span className="label">
            {render ? `Render ${render.id.slice(0, 8)} · ${relTime(render.created_at)}` : "No render yet"}
          </span>
        )}
        {renders.length > 1 ? (
          <label className="rg__pick">
            <span className="label">Render</span>
            <select value={render?.id ?? ""} onChange={(e) => setPick(e.target.value)}>
              {renders.map((r) => (
                <option key={r.id} value={r.id}>
                  {relTime(r.created_at)} · {r.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <JobError job={lastJobOf(detail, ["audio", "render"])} />
        {newer ? (
          <span className="rg__newer" role="status">
            <span className="label">A newer render is available.</span>
            <button type="button" className="btn btn--sm" onClick={() => setPick(null)}>
              Newer render available - view it
            </button>
          </span>
        ) : null}
      </div>

      {!render ? (
        <Empty title="Nothing rendered yet">
          Produce runs audio, then the render, the checks, the manifest and the gate. Start it from the{" "}
          <Link to="/studio/$projectId" params={{ projectId: pid }}>
            control room
          </Link>
          .
        </Empty>
      ) : (
        <div className="rg__grid">
          <Defer tier={1} id="rg:video" phClass="panel rg__video" minHeight={320}>
            <section className="panel rg__video">
              <h2 className="sec-h">
                <span>Render · {render.format}</span>
                <span>{checks && typeof checks.duration_s === "number" ? `${checks.duration_s} s` : ""}</span>
              </h2>
              <div className={`rg__frame${render.format === "landscape" ? " wide" : ""}`}>
                {video ? (
                  // biome-ignore lint/a11y/useMediaCaption: the captions track is added once the manifest names a sidecar
                  <video src={video} controls preload="metadata" poster={renderFile(render, "thumb.png") ?? undefined}>
                    {/* only when the manifest names the sidecar: narration-free renders write none (404) */}
                    {captionsVtt ? (
                      <track
                        kind="captions"
                        src={renderFile(render, "captions.vtt") ?? undefined}
                        srcLang="en"
                        label="English"
                      />
                    ) : null}
                  </video>
                ) : (
                  <p className="sum-p">No file URL for this render.</p>
                )}
              </div>
              <ul className="links">
                {[
                  ["video.mp4", "Video"],
                  ["captions.srt", "Captions · SRT"],
                  ["captions.vtt", "Captions · VTT"],
                  ["thumb.png", "Thumbnail"],
                  ["manifest.json", "Manifest · JSON"],
                ].map(([f, l]) => {
                  const href = renderFile(render, f as string);
                  return href ? (
                    <li key={f}>
                      <a href={href} target="_blank" rel="noreferrer">
                        {l}
                      </a>
                    </li>
                  ) : null;
                })}
              </ul>
            </section>
          </Defer>

          <Defer tier={2} id="rg:gate" phClass="panel rg__gate" minHeight={220}>
            <section className="panel rg__gate">
              <h2 className="sec-h">
                <span>Policy gate · OPA</span>
                <span>
                  {policy?.target
                    ? `${policy.target.platform} · ${policy.target.monetized ? "monetized" : "non-commercial"} · ${policy.target.visibility ?? "private"}`
                    : ""}
                </span>
              </h2>
              <div className="rg__verdict">
                <Verdict
                  detail={{ ...detail, renders: [render, ...renders.filter((r) => r.id !== render.id)] }}
                  size="lg"
                />
              </div>
              {policy ? (
                <>
                  {policy.deny.length ? (
                    <>
                      <h3 className="sec-h">
                        <span>Deny · verbatim</span>
                      </h3>
                      <ul className="reasons reasons--deny">
                        {policy.deny.map((d) => (
                          <li key={d} className="mono">
                            {d}
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p className="sum-p">No deny reason.</p>
                  )}
                  {policy.warn.length ? (
                    <>
                      <h3 className="sec-h">
                        <span>Warnings</span>
                      </h3>
                      <ul className="reasons reasons--warn">
                        {policy.warn.map((d) => (
                          <li key={d} className="mono">
                            {d}
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                  <h3 className="sec-h">
                    <span>Checks run · {policy.checks_run.length}</span>
                  </h3>
                  <ul className="checks-run">
                    {policy.checks_run.map((c) => (
                      <li key={c} className="mono">
                        {c}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="sum-p">This render carries no policy verdict.</p>
              )}
            </section>
          </Defer>

          <Defer tier={3} id="rg:checks" phClass="panel rg__checks" minHeight={200}>
            <section className="panel rg__checks">
              <h2 className="sec-h">
                <span>Post-render checks · ffprobe · ebur128</span>
              </h2>
              {!hasChecks(checks) ? (
                <p className="sum-p" data-testid="checks-empty">
                  No post-render checks were recorded for this render.
                </p>
              ) : (
                <table className="tbl tbl--checks">
                  <thead>
                    <tr>
                      <th>Check</th>
                      <th className="num">Value</th>
                      <th className="num">Target</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.key}>
                        <td>{r.label}</td>
                        <td className="num">{r.value}</td>
                        <td className="num">{r.target ?? "recorded"}</td>
                        <td>
                          {r.ok === null ? (
                            <span className="label">recorded</span>
                          ) : (
                            <StatusChip status={r.ok ? "go" : "blocked"} size={13} label={r.ok ? "PASS" : "FAIL"} />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </Defer>

          <Defer tier={4} id="rg:manifest" phClass="panel rg__manifest" minHeight={200}>
            <section className="panel rg__manifest">
              <h2 className="sec-h">
                <span>Provenance manifest</span>
                <span>{m ? m.build.composition : ""}</span>
              </h2>
              {manifest.isLoading ? (
                <Loading what="the manifest" />
              ) : manifest.isError || !m ? (
                <div className="rg__retry" role="alert">
                  <p className="sum-p">The manifest did not load from {renderFile(render, "manifest.json")}.</p>
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() => void manifest.refetch()}
                    disabled={manifest.isFetching}
                  >
                    {manifest.isFetching ? "Retrying" : "Retry"}
                  </button>
                </div>
              ) : (
                <div className="mf">
                  <dl className="mf__kv">
                    <div>
                      <dt>Subject</dt>
                      <dd className="mono">
                        {m.subject.file} · sha256 {m.subject.sha256.slice(0, 16)}…
                      </dd>
                    </div>
                    <div>
                      <dt>Build</dt>
                      <dd className="mono">
                        {m.build.composition} · {m.build.renderer} · git {m.build.git_sha.slice(0, 10)} · props{" "}
                        {m.build.props_sha256.slice(0, 12)}…
                      </dd>
                    </div>
                    <div>
                      <dt>Data</dt>
                      <dd>
                        {m.data.models.join(", ")} · licence class <b>{m.data.license_class}</b>
                      </dd>
                    </div>
                  </dl>
                  <h3 className="sec-h">
                    <span>Sources · {m.data.sources.length}</span>
                  </h3>
                  <ul className="mf__list">
                    {m.data.sources.map((s) => (
                      <li key={s.id}>
                        <b className="mono">{s.id}</b> {s.license} · {s.license_class} · snapshot {s.snapshot}
                        {s.attribution ? <span className="mf__sub">{s.attribution}</span> : null}
                      </li>
                    ))}
                  </ul>
                  <h3 className="sec-h">
                    <span>Audio · {m.audio.length} assets</span>
                  </h3>
                  <ul className="mf__list">
                    {m.audio.map((a) => (
                      <li key={a.sha256}>
                        <b>{a.kind}</b> {a.scene_id ? `· ${a.scene_id} ` : ""}· {a.provider} {a.model_id} · plan{" "}
                        {a.plan_tier} · c2pa {a.c2pa}
                      </li>
                    ))}
                  </ul>
                  <dl className="mf__kv">
                    <div>
                      <dt>Captions</dt>
                      <dd>
                        {m.captions.burned_in ? "burned in" : "not burned in"} · sidecar {m.captions.sidecar.join(", ")}{" "}
                        · max {m.captions.max_cps} cps
                      </dd>
                    </div>
                    <div>
                      <dt>Fonts</dt>
                      <dd>{m.fonts.map((f) => `${f.family} (${f.license})`).join(" · ")}</dd>
                    </div>
                    <div>
                      <dt>Disclosure</dt>
                      <dd>
                        AI voice {m.disclosure.ai_voice ? "yes" : "no"} · AI music{" "}
                        {m.disclosure.ai_music ? "yes" : "no"} · on frame {m.disclosure.on_frame ? "yes" : "no"}
                      </dd>
                    </div>
                    <div>
                      <dt>LLM</dt>
                      <dd className="mono">
                        {m.llm ? `${m.llm.engine} · ${m.llm.session_id ?? "no session id"}` : "none"}
                      </dd>
                    </div>
                  </dl>
                  <details className="mf__facts">
                    <summary>Facts cited · {m.data.facts_cited.length}</summary>
                    <ul>
                      {m.data.facts_cited.map((f) => (
                        <li key={f} className="mono">
                          {f}
                        </li>
                      ))}
                    </ul>
                  </details>
                </div>
              )}
            </section>
          </Defer>
        </div>
      )}
    </div>
  );
}
