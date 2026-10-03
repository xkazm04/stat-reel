/**
 * Keeps `e2e/fixtures/generation/**` equal to the builder (sample-fixtures.ts) and proves that the fake-mode
 * outputs pass the finalize validation. Regenerate with WRITE_FIXTURES=1 (see sample-fixtures.ts).
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { paths as appPaths } from "../config";
import { jobPaths } from "./paths";
import { sampleGenerationFixtures } from "./sample-fixtures";
import { validateDataRaceOutputs } from "./validate-data-race";

const root = path.join(appPaths.fixtures, "generation");
const built = sampleGenerationFixtures();

it.runIf(process.env.WRITE_FIXTURES === "1")("writes the fake-mode fixtures", () => {
  for (const [type, files] of Object.entries(built)) {
    rmSync(path.join(root, type), { recursive: true, force: true });
    for (const f of files) {
      const abs = path.join(root, type, f.path);
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, f.content);
    }
  }
});

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "statreel-fixtures-"));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

/** A job folder holding a copy of one type's fixtures, as the fake engine leaves it. */
function jobWith(type: "visual_options" | "generate_video", caseDataStatus = "staged") {
  const p = jobPaths("gj-00000001", tmp);
  mkdirSync(p.out, { recursive: true });
  cpSync(path.join(root, type), p.work, { recursive: true });
  writeFileSync(p.caseJson, JSON.stringify({ data_status: caseDataStatus }));
  return p;
}

describe("fake-mode fixtures", () => {
  it("the committed files are exactly what the builder produces", () => {
    for (const [type, files] of Object.entries(built)) {
      for (const f of files) {
        const abs = path.join(root, type, f.path);
        expect(existsSync(abs), `${type}/${f.path}`).toBe(true);
        expect(readFileSync(abs, "utf8"), `${type}/${f.path}`).toBe(f.content);
      }
    }
  });

  it("visual_options: three valid variants (schema, rules 1-6, ledger, distinct looks)", () => {
    const r = validateDataRaceOutputs("visual_options", jobWith("visual_options"));
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.outputs).toEqual(expect.arrayContaining(["out/variants/v1.props.json", "out/variants/v3.md", "out/timing-plan.json", "assets/logos/sample-lumen.svg"]));
  });

  it("generate_video: valid props with real provenance", () => {
    const r = validateDataRaceOutputs("generate_video", jobWith("generate_video"));
    expect(r.errors).toEqual([]);
  });

  it("the visual fixtures are sample data, the video fixture is real: a new-source case may only carry sample", () => {
    const v = JSON.parse(readFileSync(path.join(root, "visual_options", "out", "variants", "v1.props.json"), "utf8"));
    expect(v.data_provenance).toBe("sample");
    expect(JSON.parse(readFileSync(path.join(root, "generate_video", "out", "props.json"), "utf8")).data_provenance).toBe("real");
    expect(validateDataRaceOutputs("visual_options", jobWith("visual_options", "new-source")).errors).toEqual([]);
  });
});

describe("validateDataRaceOutputs refuses", () => {
  const edit = (p: ReturnType<typeof jobWith>, rel: string, fn: (o: Record<string, unknown>) => void) => {
    const f = path.join(p.out, rel);
    const o = JSON.parse(readFileSync(f, "utf8")) as Record<string, unknown>;
    fn(o);
    writeFileSync(f, JSON.stringify(o));
  };

  it("a missing variant and a missing plan, naming the file", () => {
    const p = jobWith("visual_options");
    rmSync(path.join(p.out, "variants", "v2.props.json"));
    rmSync(path.join(p.out, "timing-plan.json"));
    const r = validateDataRaceOutputs("visual_options", p);
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual(expect.arrayContaining(["missing output: out/variants/v2.props.json", "call compute_timing_plan first: it writes out/timing-plan.json"]));
  });

  it("a transition key (rule 1) and a plan sha mismatch (rule 2), verbatim with the rule number", () => {
    const p = jobWith("visual_options");
    edit(p, "variants/v1.props.json", (o) => {
      o.transition = "wipe";
      o.timing_plan_sha256 = "0".repeat(64);
    });
    const text = validateDataRaceOutputs("visual_options", p).errors.join("\n");
    expect(text).toMatch(/out\/variants\/v1\.props\.json: rule 1 \[transition-key\]/);
    expect(text).toMatch(/rule 2 \[sha-mismatch\]/);
  });

  it("a logo file without a ledger row (rule 3)", () => {
    const p = jobWith("visual_options");
    writeFileSync(path.join(p.out, "assets.json"), "[]");
    expect(validateDataRaceOutputs("visual_options", p).errors.join("\n")).toMatch(/rule 3 \[logo-no-ledger-row\]/);
  });

  it("a tampered logo file (sha256 differs from the ledger)", () => {
    const p = jobWith("visual_options");
    writeFileSync(path.join(p.assets, "logos", "sample-lumen.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
    expect(validateDataRaceOutputs("visual_options", p).errors.join("\n")).toMatch(/\[logo-sha-mismatch\]/);
  });

  it("sample data on a video, and real data claimed for a new-source case's preview", () => {
    const v = jobWith("generate_video");
    edit(v, "props.json", (o) => {
      o.data_provenance = "sample";
    });
    expect(validateDataRaceOutputs("generate_video", v).errors.join("\n")).toMatch(/a video needs data_provenance "real"/);
    const p = jobWith("visual_options", "new-source");
    edit(p, "variants/v1.props.json", (o) => {
      o.data_provenance = "real";
    });
    expect(validateDataRaceOutputs("visual_options", p).errors.join("\n")).toMatch(/set data_provenance "sample"/);
  });

  it("three variants that share one colour set", () => {
    const p = jobWith("visual_options");
    cpSync(path.join(p.out, "variants", "v1.props.json"), path.join(p.out, "variants", "v2.props.json"));
    expect(validateDataRaceOutputs("visual_options", p).errors.join("\n")).toMatch(/three distinct looks/);
  });

  it("a style note over 80 words", () => {
    const p = jobWith("visual_options");
    writeFileSync(path.join(p.out, "variants", "v3.md"), `# Long\n\n${"word ".repeat(90)}`);
    expect(validateDataRaceOutputs("visual_options", p).errors.join("\n")).toMatch(/at most 80 words/);
  });
});
