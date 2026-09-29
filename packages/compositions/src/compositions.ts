/** Composition ids and metadata, importable without React/Remotion side effects. */
import { EraAdjustedPropsSchema, type Format, sampleEraProps } from "@statreel/schemas";
import { DEFAULT_DURATION_S, durationOf } from "./timing";

export const FPS = 30;

export const COMPOSITIONS = [
  {
    id: "EraAdjustedSlope-vertical",
    component: "EraAdjustedSlope",
    usecase: "era-adjusted-rankings",
    format: "vertical",
    width: 1080,
    height: 1920,
    fps: FPS,
    defaultDurationS: DEFAULT_DURATION_S,
  },
  {
    id: "EraAdjustedSlope-landscape",
    component: "EraAdjustedSlope",
    usecase: "era-adjusted-rankings",
    format: "landscape",
    width: 1920,
    height: 1080,
    fps: FPS,
    defaultDurationS: DEFAULT_DURATION_S,
  },
] as const satisfies readonly {
  id: string;
  component: string;
  usecase: string;
  format: Format;
  width: number;
  height: number;
  fps: number;
  defaultDurationS: number;
}[];

export type CompositionId = (typeof COMPOSITIONS)[number]["id"];

export function compositionIdFor(format: Format, component = "EraAdjustedSlope"): CompositionId {
  const c = COMPOSITIONS.find((x) => x.format === format && x.component === component);
  if (!c) throw new Error(`no composition for ${component} / ${format}`);
  return c.id;
}

/** The plain object schema Remotion accepts; the refined schema is enforced in calculateMetadata. */
export const eraPropsObjectSchema = EraAdjustedPropsSchema.innerType();

export const durationInFramesFor = (timing: { duration_s: number } | undefined | null, fps = FPS): number =>
  Math.max(1, Math.ceil(durationOf(timing) * fps));

export const defaultPropsFor = (format: Format) => ({ ...sampleEraProps, format });
