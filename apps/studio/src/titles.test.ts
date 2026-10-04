import { describe, expect, it } from "vitest";
import { NAV_LINKS } from "./components/Nav";
import { router } from "./router";
import { studioProjectId, titleFor } from "./titles";

/**
 * Three hand-kept lists name the screens: the route tree (router.tsx), the nav (Nav.tsx NAV_LINKS) and
 * the title table (titles.ts). The route tree is the ground truth (app-shell/navigation-model: adding a
 * section must not update one list but not the other); this derives the population from it.
 */
describe("screens: routes, nav and titles agree", () => {
  const sample: Record<string, string> = { $usecase: "bar-race", $sport: "F1", $projectId: "p-1" };
  const paths = Object.keys(router.routesByPath).map((p) => p.replace(/\$[A-Za-z]+/g, (k) => sample[k] ?? "x"));

  it("every route has a title of its own", () => {
    expect(paths.length).toBeGreaterThanOrEqual(10);
    expect(paths.filter((p) => titleFor(p) === "Off air · StatReel")).toEqual([]);
  });
  it("every route lights exactly one nav entry", () => {
    expect(paths.filter((p) => NAV_LINKS.filter((l) => l.match(p)).length !== 1)).toEqual([]);
  });
  it("every nav entry is a route, and its title starts with the nav's word", () => {
    for (const l of NAV_LINKS) {
      expect(paths).toContain(l.to);
      expect(titleFor(l.to).startsWith(l.label)).toBe(true);
    }
  });
});

describe("titleFor", () => {
  it("names each screen", () => {
    expect(titleFor("/")).toBe("Front · StatReel");
    expect(titleFor("/projects")).toBe("Rundown · StatReel");
    expect(titleFor("/calendar/")).toBe("Calendar · StatReel");
    expect(titleFor("/board")).toBe("Board · StatReel");
    expect(titleFor("/metrics")).toBe("Metrics · StatReel");
    expect(titleFor("/sources")).toBe("Sources · StatReel");
    expect(titleFor("/studio")).toBe("Studio · StatReel");
  });
  it("heatmap: grid, view and cell layer", () => {
    expect(titleFor("/heatmap")).toBe("Heatmap · StatReel");
    expect(titleFor("/heatmap", { view: "feasibility" })).toBe("Heatmap · Feasibility · StatReel");
    expect(titleFor("/heatmap/bar-race/F1")).toBe("Heatmap · bar-race · F1 · StatReel");
  });
  it("studio: project title when known, id until then, tab name", () => {
    expect(titleFor("/studio/p-1", { projectTitle: "Monaco poles" })).toBe("Studio · Monaco poles · StatReel");
    expect(titleFor("/studio/p-1")).toBe("Studio · p-1 · StatReel");
    expect(titleFor("/studio/p-1/render", { projectTitle: "Monaco poles" })).toBe("Render & Gate · Monaco poles · StatReel");
    expect(titleFor("/studio/p%201", { projectTitle: "  " })).toBe("Studio · p 1 · StatReel");
  });
  it("unknown addresses say so", () => {
    expect(titleFor("/nope")).toBe("Off air · StatReel");
  });
  it("studioProjectId", () => {
    expect(studioProjectId("/studio/p-1/render")).toBe("p-1");
    expect(studioProjectId("/studio")).toBeNull();
    expect(studioProjectId("/projects")).toBeNull();
  });
});
