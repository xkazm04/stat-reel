/**
 * DataRace: the Remotion component. Parses the props (a bad prop set fails before the first frame),
 * reads the frame and hands it to the pure frame renderer. No state, no effects, no CSS transitions.
 */
import { videoTheme } from "@statreel/design-tokens";
import { DataRacePropsSchema } from "@statreel/schemas";
import type { ReactElement } from "react";
import { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import "../fonts";
import { DataRaceFrame } from "./DataRaceFrame";
import type { DataRaceRenderProps } from "./state";

/** Parses render props; throws unless `timing_plan` is embedded (use `resolveDataRaceRenderProps`). */
export function parseDataRaceRenderProps(input: unknown): DataRaceRenderProps {
  const parsed = DataRacePropsSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new Error(`invalid DataRaceProps - ${issues}`);
  }
  if (!parsed.data.timing_plan)
    throw new Error("DataRace render props must embed timing_plan (resolveDataRaceRenderProps(props, plan))");
  return parsed.data as DataRaceRenderProps;
}

export function DataRace(input: Record<string, unknown>): ReactElement {
  const frame = useCurrentFrame();
  const props = useMemo(() => parseDataRaceRenderProps(input), [input]);
  return (
    <AbsoluteFill style={{ backgroundColor: videoTheme.background }}>
      <DataRaceFrame props={props} frame={frame} />
    </AbsoluteFill>
  );
}
