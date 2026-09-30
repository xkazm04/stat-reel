/**
 * 06 Publish: per platform. YouTube is wired (private only); TikTok and Instagram are shown as not
 * wired yet (M5). Title, description, tags; visibility fixed to private (and why); the AI-disclosure
 * flag as the manifest sets it; what the server appends; the publication status and dry-run marker.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { api, errorText, qk } from "../api";
import { StatusChip } from "../components/glyphs";
import { Empty } from "../components/ui";
import { latestRender, renderPolicy, useManifest } from "../data";
import { relTime } from "../logic";
import { composeDescription, parseTags } from "../onair";
import { JobError, JobLine, lastJobOf, PublicationStatus, publishJob, useStudio } from "./shared";

type Platform = "youtube" | "tiktok" | "instagram";
const PLATFORMS: { id: Platform; name: string; wired: boolean; note: string }[] = [
  { id: "youtube", name: "YouTube", wired: true, note: "Data API v3 · private upload + SRT captions" },
  { id: "tiktok", name: "TikTok", wired: false, note: "Content Posting API · not wired yet (M5)" },
  { id: "instagram", name: "Instagram", wired: false, note: "Graph API Reels · not wired yet (M5)" },
];

export function PublishPage() {
  const { detail } = useStudio();
  const qc = useQueryClient();
  const [platform, setPlatform] = useState<Platform>("youtube");
  const render = latestRender(detail);
  const policy = renderPolicy(render);
  const manifest = useManifest(render);
  const props = detail?.props?.props;
  const [title, setTitle] = useState<string | null>(null);
  const [desc, setDesc] = useState<string | null>(null);
  const [tags, setTags] = useState<string | null>(null);
  const pid = detail?.project.id ?? "";
  const tTitle = title ?? (props?.title ?? detail?.project.title ?? "").slice(0, 100);
  const tDesc = desc ?? props?.title ?? detail?.project.title ?? "";
  const tTags = tags ?? [detail?.project.sport, "data"].filter(Boolean).join(", ");
  const publish = useMutation({
    mutationFn: () =>
      api.publish(pid, {
        platform: "youtube",
        title: tTitle.slice(0, 100),
        description: tDesc,
        tags: parseTags(tTags),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.project(pid) }),
  });
  if (!detail) return null;
  const running = publishJob(detail);
  const p = PLATFORMS.find((x) => x.id === platform) ?? (PLATFORMS[0] as (typeof PLATFORMS)[number]);
  const m = manifest.data;
  const synthetic = m ? m.disclosure.ai_voice || m.disclosure.ai_music : null;
  const preview = composeDescription({
    description: tDesc,
    fallbackTitle: detail.project.title,
    methodNote: props?.method_note,
    attributions: m?.data.sources.map((s) => s.attribution) ?? [],
  });
  const can = !!policy?.allow && !running && p.wired;

  return (
    <div className="pubp">
      <nav className="plat" aria-label="Platforms">
        {PLATFORMS.map((x) => (
          <button type="button" key={x.id} aria-pressed={platform === x.id} onClick={() => setPlatform(x.id)}>
            <b>{x.name}</b>
            <span>{x.wired ? "wired · private only" : "not wired yet (M5)"}</span>
          </button>
        ))}
      </nav>

      {!p.wired ? (
        <Empty title={`${p.name}: not wired yet (M5)`}>
          {p.note}. Its OAuth redirect rules for a local app are still an open question (DESIGN §6.7); until M5 there is
          no form here, and nothing is sent.
        </Empty>
      ) : (
        <div className="pubp__grid">
          <section className="panel">
            <h2 className="sec-h">
              <span>YouTube · {p.note}</span>
            </h2>
            {!render ? (
              <Empty title="Nothing to publish yet">
                Produce first: publishing needs a render the gate allows.{" "}
                <Link to="/studio/$projectId" params={{ projectId: pid }}>
                  Control room
                </Link>
              </Empty>
            ) : !policy?.allow ? (
              <div className="failure">
                <b>The gate denies this render</b>
                {(policy?.deny ?? ["no verdict"]).map((d) => (
                  <span key={d} className="mono">
                    {d}
                  </span>
                ))}
              </div>
            ) : null}
            <form
              className="form"
              onSubmit={(e) => {
                e.preventDefault();
                if (can) publish.mutate();
              }}
            >
              <label>
                <span className="label">Title · {tTitle.length}/100</span>
                <input value={tTitle} maxLength={100} onChange={(e) => setTitle(e.target.value)} />
              </label>
              <label>
                <span className="label">Description (your part)</span>
                <textarea rows={4} value={tDesc} onChange={(e) => setDesc(e.target.value)} />
              </label>
              <label>
                <span className="label">Tags · comma separated</span>
                <input value={tTags} onChange={(e) => setTags(e.target.value)} />
              </label>
              <label>
                <span className="label">Visibility</span>
                <select value="private" disabled aria-describedby="vis-why">
                  <option value="private">Private</option>
                </select>
                <span id="vis-why" className="form__why">
                  Private only: public is the owner's call, and YouTube forces uploads from an unaudited API project to
                  private anyway. The owner flips it on YouTube.
                </span>
              </label>
              <div className="form__flag">
                <span className="label">AI disclosure · "altered or synthetic content"</span>
                {synthetic === null ? (
                  <span>{manifest.isLoading ? "reading the manifest" : "unknown until a manifest exists"}</span>
                ) : (
                  <span>
                    <StatusChip
                      status={synthetic ? "go" : "data-ready"}
                      size={13}
                      label={synthetic ? "WILL BE TICKED" : "NOT NEEDED"}
                    />{" "}
                    AI voice {m?.disclosure.ai_voice ? "yes" : "no"} · AI music {m?.disclosure.ai_music ? "yes" : "no"}{" "}
                    · on-frame label {m?.disclosure.on_frame ? "yes" : "no"}
                  </span>
                )}
              </div>
              <div className="form__bar">
                <button
                  type="submit"
                  className="btn btn--primary"
                  data-testid="publish-submit"
                  disabled={!can || publish.isPending || !tTitle.trim()}
                >
                  {running ? "Publishing" : detail.publications.length ? "Publish again (private)" : "Publish private"}
                </button>
                {running ? <JobLine job={running} projectId={pid} /> : null}
                {publish.isError ? <span className="joberr">{errorText(publish.error)}</span> : null}
              </div>
              <JobError job={lastJobOf(detail, ["publish"])} />
            </form>
          </section>

          <section className="panel">
            <h2 className="sec-h">
              <span>What the server sends as the description</span>
            </h2>
            <p className="sum-p">
              Attribution, the method note and the AI disclosure are appended server-side at publish time; you cannot
              drop them.
            </p>
            <pre className="desc-preview">{preview}</pre>
            <h2 className="sec-h sec-h--gap">
              <span>Publications</span>
              <PublicationStatus detail={detail} />
            </h2>
            {detail.publications.length ? (
              <ul className="pubs">
                {detail.publications.map((x) => (
                  <li key={x.id}>
                    <span className="pub pub--private">
                      <i />
                      {x.visibility}
                    </span>
                    <b>{x.platform}</b>
                    {x.mode === "dry" ? <span className="dry">DRY RUN · nothing uploaded</span> : null}
                    <span className="mono">{x.external_id ?? "no id"}</span>
                    {x.url ? (
                      <a href={x.url} target="_blank" rel="noreferrer">
                        {x.url}
                      </a>
                    ) : (
                      <span className="label">no public URL</span>
                    )}
                    <span className="label">{relTime(x.published_at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="sum-p">Not sent to any platform yet.</p>
            )}
            <p className="page__foot">
              Publishing runs dry until the owner creates the Google Cloud app (packages/publish/SETUP.md): a dry run
              plans the upload and records it, and uploads nothing.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
