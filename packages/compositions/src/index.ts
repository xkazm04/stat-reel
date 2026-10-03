/**
 * @statreel/compositions - Remotion compositions per use case x format (DESIGN.md §6.2-6.3).
 * The bundle entry is `src/entry.ts`; this module is for the server/studio (ids, metadata,
 * fonts for the provenance manifest) and for the Player.
 */
export { type AudioCue, AudioTracks, audioCues } from "./AudioTracks";
export {
  COMPOSITIONS,
  type CompositionId,
  compositionIdFor,
  defaultPropsFor,
  durationInFramesFor,
  eraPropsObjectSchema,
  FPS,
} from "./compositions";
export {
  DISCLOSURE_TEXT,
  EraAdjustedFrame,
  type EraAdjustedFrameProps,
  type EraAdjustedInput,
  toSlopeRows,
} from "./EraAdjustedFrame";
export { EraAdjustedSlope } from "./EraAdjustedSlope";
export { FONT_FACES, FONTS_USED, REQUIRED_FAMILIES } from "./fonts";
export { criticalBox, type FrameLayout, frameLayout, type Rect } from "./layout";
export { calculateEraMetadata, Root } from "./Root";
export { SafeZoneOverlay } from "./SafeZoneOverlay";
export {
  DEFAULT_DURATION_S,
  DEFAULT_VOICE_LEAD_S,
  type FrameState,
  frameState,
  type ResolvedScene,
  resolveScenes,
  sceneAt,
  type TimingInput,
} from "./timing";
export {
  buildSampleDataRace,
  CARD,
  type CardState,
  DataRace,
  DataRaceFrame,
  type DataRaceRenderProps,
  type DataRaceState,
  dataRaceState,
  orderedEvents,
  parseDataRaceRenderProps,
  type Phase,
  phaseAt,
  type RaceRow,
  type SampleDataRace,
  sampleDataRaceLedger,
} from "./DataRace/index";
export { calculateDataRaceMetadata } from "./Root";
export {
  computeTimingPlan,
  makeTimeMap,
  movingAverage,
  periodAtFrame,
  rankOrder,
  renderTimingMd,
  stickyOrders,
  type TimeMap,
  type TimingEventInput,
  type TimingOptions,
  type TimingPlanInput,
} from "./timing/index";
