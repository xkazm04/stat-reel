/**
 * @statreel/captions - timed words from TTS alignment, Netflix-rule cue segmentation, SRT/VTT
 * sidecars and the seek-stable burn-in component (DESIGN.md §6.4-6.5). No Remotion imports.
 */
export { type AnnotationCueOptions, type AnnotationEvent, cuesFromAnnotations } from "./annotations";
export { wordsFromAlignment } from "./align";
export {
  activeCueAt,
  activeWordIndex,
  BurnedCaptions,
  type BurnedCaptionsProps,
  wordsByLine,
} from "./BurnedCaptions";
export {
  type BuildCuesOptions,
  buildCues,
  CUE_RULES,
  cueChars,
  cueCps,
  layoutLines,
  maxCharsPerLine,
  maxCps,
} from "./cues";
export {
  AVG_CHAR_EM,
  CAPTION_STYLE,
  type CaptionBox,
  captionBox,
  captionSafeZoneViolations,
  captionTextWidth,
  estimateLineWidth,
  fitCharsPerLine,
} from "./geometry";
export { isGlued, joinDisplay } from "./text";
export { toSrt, toVtt } from "./writers";
