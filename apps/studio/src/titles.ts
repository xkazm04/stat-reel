/**
 * The document title of every screen (app-shell: the title names where the owner is, so a tab
 * strip, history entry and screen reader announcement all say it). One pure table, no per-page
 * edits. `ctx.projectTitle` is the open project's own title when it is known; until then the id
 * stands in. No React, no DOM (unit-tested in titles.test.ts).
 */
export const APP_TITLE = "StatReel";

export type TitleContext = { projectTitle?: string | null; view?: string | null };

const decode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

const SCREEN: Record<string, string> = {
  "/": "Front",
  "/projects": "Rundown",
  "/calendar": "Calendar",
  "/board": "Board",
  "/metrics": "Metrics",
  "/sources": "Sources",
};

/** The page-specific parts of the title, most specific last; `titleFor` joins them. */
function parts(pathname: string, ctx: TitleContext): string[] {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const known = SCREEN[path];
  if (known) return [known];
  const seg = path.split("/").filter(Boolean).map(decode);
  if (seg[0] === "heatmap") {
    if (seg.length >= 3) return ["Heatmap", `${seg[1]} · ${seg[2]}`];
    return ctx.view === "feasibility" ? ["Heatmap", "Feasibility"] : ["Heatmap"];
  }
  if (seg[0] === "studio") {
    if (seg.length === 1) return ["Studio"];
    const who = ctx.projectTitle?.trim() || (seg[1] as string);
    const tab = seg[2] === "render" ? "Render & Gate" : seg[2] === "publish" ? "Calendar" : "Studio";
    return [tab, who];
  }
  return ["Off air"];
}

export const titleFor = (pathname: string, ctx: TitleContext = {}): string =>
  [...parts(pathname, ctx), APP_TITLE].join(" · ");

/** The project id of a /studio/$projectId[/...] path, else null. */
export function studioProjectId(pathname: string): string | null {
  const m = /^\/studio\/([^/]+)/.exec(pathname);
  return m ? decode(m[1] as string) : null;
}
