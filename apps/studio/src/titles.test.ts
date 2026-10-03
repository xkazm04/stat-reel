import { describe, expect, it } from "vitest";
import { studioProjectId, titleFor } from "./titles";

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
