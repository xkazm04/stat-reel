/**
 * Feasibility heatmap (DESIGN §7): use case x sport x mode from TESTED capabilities
 * (meta.capabilities), the registry and which compositions exist. Registry declarations alone never
 * make a cell ready: "declared but not tested" is a Blocked cell that says so.
 */
import type { CellStatus, HeatmapCell, LicenseClass, Mode, Source, Sport, UseCase } from "@statreel/schemas";

export type Capability = {
  sport: string; kind: string; source_id: string; license_class: string; status: string;
  coverage_from: number | null; coverage_to: number | null; rows: number; detail: string;
};

const SPORTS: Sport[] = ["F1", "NBA", "NHL", "Soccer"];
const MODES: Mode[] = ["monetized", "non_commercial"];
const ALLOWED: Record<Mode, Set<string>> = { monetized: new Set(["legal"]), non_commercial: new Set(["legal", "non_commercial"]) };
const RANK: Record<string, number> = { legal: 0, non_commercial: 1, paid: 2, avoid: 9 };

export function computeHeatmap(input: {
  usecases: UseCase[]; sources: Source[]; capabilities: Capability[]; implemented: Set<string>; needsReview?: Set<string>;
}): HeatmapCell[] {
  const { usecases, sources, capabilities, implemented, needsReview = new Set() } = input;
  const cells: HeatmapCell[] = [];
  for (const uc of usecases) {
    const built = !!uc.composition && implemented.has(uc.composition);
    for (const sport of SPORTS) {
      for (const mode of MODES) {
        const kinds = uc.requires.kinds.map((kind) => {
          const declared = sources.filter((s) => (s.sport === sport || s.sport === "all") && s.kinds.includes(kind) && s.verdict !== "avoid");
          const tested = capabilities.filter((c) => c.sport === sport && c.kind === kind && c.license_class !== "avoid");
          const passing = tested.filter((c) => c.status === "pass" && !needsReview.has(c.source_id));
          const best = passing.sort((a, b) => RANK[a.license_class]! - RANK[b.license_class]!)[0];
          return {
            kind,
            best: (best?.license_class ?? null) as LicenseClass | null,
            tested: tested.length > 0,
            failing: tested.filter((c) => c.status !== "pass").map((c) => c.source_id),
            declared: declared.map((s) => s.id),
            sources: [
              ...tested.map((c) => ({ id: c.source_id, license_class: c.license_class as LicenseClass, status: needsReview.has(c.source_id) ? "needs_review" : c.status })),
              ...declared.filter((s) => !tested.some((c) => c.source_id === s.id)).map((s) => ({ id: s.id, license_class: s.verdict, status: "declared" })),
            ],
          };
        });
        let status: CellStatus;
        let reason: string;
        const blocked = kinds.filter((k) => !k.best);
        const notAllowed = kinds.filter((k) => k.best && !ALLOWED[mode].has(k.best));
        if (blocked.length) {
          status = "blocked";
          reason = blocked.map((k) =>
            k.failing.length ? `${k.kind}: failing capability test (${k.failing.join(", ")})`
            : k.declared.length ? `${k.kind}: not tested yet (declared by ${k.declared.join(", ")})`
            : `${k.kind}: no source in the registry`).join("; ");
        } else if (notAllowed.length) {
          status = "ask";
          reason = notAllowed.map((k) => `${k.kind}: best tested source is ${k.best}, not allowed in ${mode} mode`).join("; ");
        } else if (!built) {
          status = "data-ready";
          reason = uc.composition ? `data allowed; composition ${uc.composition} not implemented yet` : "data allowed; no composition designed yet";
        } else {
          status = "go";
          reason = "every required kind passes with an allowed licence and the composition is implemented";
        }
        cells.push({
          usecase: uc.id, sport, mode, status, reason, composition_implemented: built,
          kinds: kinds.map(({ kind, best, tested, sources: s }) => ({ kind, best, tested, sources: s })),
        });
      }
    }
  }
  return cells;
}
