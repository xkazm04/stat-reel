/** Remotion root: one <Composition> per use case x format. */
import { EraAdjustedPropsSchema } from "@statreel/schemas";
import type { ReactElement } from "react";
import { type CalculateMetadataFunction, Composition } from "remotion";
import type { z } from "zod";
import { COMPOSITIONS, defaultPropsFor, durationInFramesFor, eraPropsObjectSchema } from "./compositions";
import { EraAdjustedSlope } from "./EraAdjustedSlope";

type SchemaInput = z.input<typeof eraPropsObjectSchema>;

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

export function Root(): ReactElement {
  return (
    <>
      {COMPOSITIONS.map((c) => (
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
      ))}
    </>
  );
}
