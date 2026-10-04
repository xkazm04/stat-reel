/**
 * @statreel/viz - pure `(data, t, theme, format)` chart primitives returning React SVG.
 * No Remotion imports; the only time source is the `t` the caller passes (DESIGN.md §6.2).
 */
export {
  Callout,
  type CalloutProps,
  DIGIT_EM,
  type DigitColumn,
  digitCount,
  rollingDigits,
} from "./Callout";
export { DataClock, type DataClockProps, dataClockLabel, MIN_CLOCK_FONT } from "./DataClock";
export {
  fallbackColor,
  headAt,
  type LineRaceLayout,
  type LineRaceOptions,
  lineRaceLayout,
  type RaceHead,
  type RacePadding,
  type RacePoint,
  type RaceSeries,
  type RaceSeriesLayout,
} from "./line-race";
export { LineRace, type LineRaceProps } from "./LineRace";
export { hashString, seededRandom } from "./rng";
export { lineProgress, Slopegraph, type SlopegraphLabels, type SlopegraphProps } from "./Slopegraph";
export {
  clamp,
  dbToGain,
  type Easing,
  easeInOutCubic,
  easeOutCubic,
  easeOutQuint,
  type InterpolateOptions,
  interpolate,
  type LinearScale,
  lerp,
  linear,
  scaleLinear,
  scaleRank,
  springEase,
  stagger,
} from "./scales";
export {
  type AxisAnchor,
  dodge,
  type Padding,
  type SlopegraphLayout,
  type SlopegraphLayoutOptions,
  type SlopegraphTitles,
  type SlopeRow,
  type SlopeRowLayout,
  slopegraphLayout,
} from "./slopegraph-layout";
export {
  CHAR_EM,
  DEFAULT_WEIGHT,
  ellipsize,
  estimateWidth,
  type FaceKey,
  fitText,
  formatFixed,
  measureText,
  ordinal,
  ordinalSuffix,
  surname,
  wrapText,
} from "./text";
export {
  type DomainConfig,
  declaredDomain,
  domainProgress,
  parseTime,
  scaleTime,
  type TimeScale,
  type TimeTick,
  type TimeValue,
  yearTicks,
} from "./time-scale";
export { niceStep, niceTicks } from "./ticks";
export { type Point, TABULAR, type VizFormat, type VizTheme } from "./types";
