/** Remotion root: one <Composition> per use case x format. */
import { EraAdjustedPropsSchema, DataRacePropsSchema, resolveDataRaceRenderProps } from "@statreel/schemas";
import type { ReactElement } from "react";
import { type CalculateMetadataFunction, Composition } from "remotion";
import type { z } from "zod";
import { COMPOSITIONS, defaultPropsFor, durationInFramesFor, eraPropsObjectSchema } from "./compositions";
import { DataRace, parseDataRaceRenderProps } from "./DataRace/DataRace";
import { buildSampleDataRace } from "./DataRace/fixture";
import { EraAdjustedSlope } from "./EraAdjustedSlope";

type SchemaInput = z.input<typeof eraPropsObjectSchema>;
type DataRaceSchemaInput = z.input<typeof DataRacePropsSchema>;

/**
 * Remotion takes the plain ZodObject as `schema`; the refinements (hook first, vertical ends on a
 * reframe close, highlight is one of the rows) are enforced here, so a bad prop set fails the
 * render before the first frame.
 */
export const calculateEraMetadata: CalculateMetadataFunction<SchemaInput> = ({ props, compositionId }) => {
  const parsed = EraAdjustedPropsSchema.safeParse(props);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new Error(`${compositionId}: invalid EraAdjustedProps - ${issues}`);
  }
  const c = COMPOSITIONS.find((x) => x.id === compositionId);
  return {
    durationInFrames: durationInFramesFor(parsed.data.timing, c?.fps),
    props: parsed.data,
  };
};

/** DataRace: the duration is the timing plan's total (hook + data time + the fixed 210-frame ending). */
export const calculateDataRaceMetadata: CalculateMetadataFunction<DataRaceSchemaInput> = ({ props, compositionId }) => {
  try {
    const parsed = parseDataRaceRenderProps(props);
    return { durationInFrames: parsed.timing_plan.sections.total, props: parsed };
  } catch (err) {
    throw new Error(`${compositionId}: ${err instanceof Error ? err.message : String(err)}`);
  }
};

const sampleRace = buildSampleDataRace();
const sampleRaceProps = resolveDataRaceRenderProps(DataRacePropsSchema.parse(sampleRace.props), sampleRace.plan);

export function Root(): ReactElement {
  return (
    <>
      {COMPOSITIONS.map((c) =>
        c.component === "DataRace" ? (
          <Composition
            key={c.id}
            id={c.id}
            component={DataRace}
            schema={DataRacePropsSchema}
            defaultProps={sampleRaceProps as DataRaceSchemaInput}
            calculateMetadata={calculateDataRaceMetadata}
            width={c.width}
            height={c.height}
            fps={c.fps}
            durationInFrames={sampleRace.plan.sections.total}
          />
        ) : (
          <Composition
            key={c.id}
            id={c.id}
            component={EraAdjustedSlope}
            schema={eraPropsObjectSchema}
            defaultProps={defaultPropsFor(c.format)}
            calculateMetadata={calculateEraMetadata}
            width={c.width}
            height={c.height}
            fps={c.fps}
            durationInFrames={durationInFramesFor(undefined, c.fps)}
          />
        ),
      )}
    </>
  );
}
