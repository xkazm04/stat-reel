/**
 * One-line fix hints for OPA deny reasons (policy/publish.rego). The reason text itself is shown
 * verbatim by the screens; a hint is added only when the reason matches a known rule, never in its
 * place. Unknown reasons (a new rule, a changed message) return null: no guess. No React, no DOM.
 * deny-hints.test.ts reads the rego and fails when a deny message has no hint.
 */

const MEASURED = "Measured on the render: fix the cause (props, script or pipeline), then Produce again.";

const RULES: [RegExp, string][] = [
  [
    /^source .+ is .+: not allowed on a monetized channel$/,
    "Make the project non-commercial, or use a source whose licence allows monetized use.",
  ],
  [
    /^data license class .+: not allowed on a monetized channel$/,
    "A view behind the video has a non-legal or unrecorded licence lineage; run just transform, or make the project non-commercial.",
  ],
  [/^source .+ has verdict avoid$/, "Drop this source from the props; an avoid source can never ship."],
  [
    /^source .+ has no (id|license_class|verdict)$/,
    "Complete the source's entry in data/registry/sources.yaml, then Produce again.",
  ],
  [/^no data sources recorded$/, "The props must cite their data sources; check them, then Produce again."],
  [
    /^\S+ audio generated on free plan \(non-commercial\)$/,
    "Generate the audio on a paid ElevenLabs plan, or make the project non-commercial.",
  ],
  [
    /^\S+ audio has unknown plan_tier /,
    "The audio's plan tier is not an ElevenLabs plan StatReel knows; Produce again so it is regenerated and stamped.",
  ],
  [
    /^\S+ audio has no plan_tier$/,
    "The audio's plan tier was not recorded; Produce again so the audio is regenerated with it.",
  ],
  [/^font .+ is not OFL$/, "Use only OFL fonts from fonts/ in the composition."],
  [/^font .+ is not in the shipped-font allow-list$/, "Use only the fonts shipped in fonts/ (fonts.manifest.json)."],
  [/^no fonts recorded$/, "The render produced no font report; Produce again."],
  [
    /^font fallbacks detected: /,
    "A glyph fell back to a system font; fix the font stack or missing glyphs, then Produce again.",
  ],
  [/^missing evidence: /, "A post-render check did not record; Produce again to measure it."],
  [/^invalid evidence: /, "A post-render check recorded a non-number; Produce again to measure it."],
  [/^loudness outside /, `${MEASURED} Mastering targets -14 LUFS.`],
  [/^true peak above /, `${MEASURED} Mastering targets a true peak of -2 dBTP or lower.`],
  [/^resolution is not /, "The render must be 1080x1920 (vertical) or 1920x1080 (landscape); check the props format."],
  [/^frame rate is not 30 fps$/, "The render must be 30 fps; check the composition's frame rate."],
  [/^duration outside the 30-90 s band$/, "Edit the script so the video runs 30-90 s, then Produce again."],
  [/^black frames longer than 1 s$/, "Remove the empty stretch (a scene with no picture), then Produce again."],
  [/^captions not burned in$/, "The composition must burn the captions into the frame."],
  [
    /^caption reading speed above 20 CPS$/,
    "Shorten the narration or lengthen the scene so captions read at 20 CPS or less.",
  ],
  [/^safe-zone violations$/, "Move or shorten the captions so they stay inside the platform safe zone."],
  [/^AI music used but disclosure flag not set$/, "Produce with the AI disclosure flag on."],
  [
    /^AI audio used but disclosure not placed on the frame$/,
    "Place the AI disclosure on the frame (composition) and Produce again.",
  ],
  [/^manifest declares AI audio but target\.ai_disclosure is not set$/, "Produce with the AI disclosure flag on."],
  [
    /^\S+ audio present but disclosure\.\S+ is not true$/,
    "The manifest's disclosure does not match the audio it lists; Produce again.",
  ],
  [/^visibility .+ on .+ requires owner approval/, "v1 publishes private only; keep the target visibility private."],
];

/** The fix hint for one deny reason, or null when the reason is not a known rule. */
export function denyHint(reason: string): string | null {
  for (const [re, hint] of RULES) if (re.test(reason)) return hint;
  return null;
}
