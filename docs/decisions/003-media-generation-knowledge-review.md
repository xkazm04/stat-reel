# 003 - Changes proposed by the ai-registry media-generation review

- Status: **proposed**. Owner decision needed before Lane 2 M1 work starts.
- Date: 2026-09-29
- Source: DESIGN.md read against `ai-registry/knowledge/media-generation` (21 subjects, 146
  techniques) and its `_laws.md`. Paths below are relative to that bundle.

The review supports the architecture: charts drawn by code, pure `(data, t)` rendering, length set
by the narration, a measured −14 LUFS target, provenance per asset, and an asymmetric safe zone.
The items below are where it contradicts or goes further than the design, most urgent first.

| # | Change | DESIGN § | Evidence | Lane / when |
|---|---|---|---|---|
| 1 | **Publish gate denies when evidence is missing.** Today a missing `plan_tier`, `max_cps`, `safe_zone_violations` or an empty `fonts[]` passes the gate. Add loudness and true-peak deny rules, and have the gate report which checks it actually ran. | 6.8 | `_laws.md#unmeasured-is-not-pass`; `audio-generation/.../rights-and-provenance-record.md` | Lane 2 M1 (policy) |
| 2 | **Bind on-screen figures to facts.** Props and scripts reference `fact_key`s returned by `query`, and `set_props` rejects a figure it cannot trace. *Lane 1 already emits `fact_key` on every `llm.*` row.* | 6.2, 6.6 | `research-grounding/evidence-bound-visuals/techniques/figure-must-cite-a-fact.md` | Lane 2 M1 (schema) |
| 3 | **Label adjusted values as estimates.** Rank-led presentation, no fine axis, "era-adjusted" in copy. *Lane 1 views carry `method` and document the estimate.* | 5.5, 6.2 | `.../precision-limit-propagation.md`; `_laws.md#output-never-outruns-evidence` | M1 composition |
| 4 | **Hook shape as a prop.** One sentence at 0 s, both spoken and on screen. Order of preference: payoff first, then contradiction, scenario, stake. "Did you know" is never the default. | 6.2 | `production-ops/platform-format-adaptation/techniques/hook-shape-selection.md` | M1 props |
| 5 | **End shorts on a looping reframe.** Keep end cards for landscape only. | 6.2 | `narrative-craft/short-form-narrative-structure/techniques/reframe-close.md` | M1 |
| 6 | **Per-use-case duration band, separate from the platform ceiling.** The 3-minute ceiling is not the target. | 6.3 | `platform-format-adaptation.md` | M1 |
| 7 | **Script tokens get a `display` and a `spoken` form, plus a pronunciation ledger.** "23" vs "twenty-three", Räikkönen. Align audio on the spoken form, burn in the display form. | 6.4, 6.5 | `narrative-craft/creator-voice-and-tone/techniques/spoken-delivery-direction.md` | Lane 2 M1 (schema) |
| 8 | **Word budget as a range, with timing judged on rendered audio.** Figures take longer to say than their word count suggests. | 6.6 | `.../delivery-rate-budgeting.md` | M1 |
| 9 | **Mix: duck music 6-12 dB, not 15-18.** Spot music cue by cue with silences. Generate music after TTS is measured, at exact length, and reject off-length takes. Audio leads picture by 0.5-2 s at cuts. | 6.4 | `production-ops/video-assembly/techniques/music-spotting-against-picture.md`; `audio-generation/music-prompt-composition/techniques/duration-and-tempo-locking.md` | M1 audio |
| 10 | **True peak ≤ −2 dBTP** (platforms re-encode to lossy audio). Also measure loudness range. | 6.3 | `.../loudness-and-peak-acceptance.md` | M1 checks |
| 11 | **Critique loop:** a typed yes/no schema with a veto first, and safe zone and contrast measured in code. Revisions are patch operations, with the gate re-run after each. | 6.6 | `visual-generation/generated-output-grading/techniques/vision-model-grading-schema.md`; `review-iteration-loops/techniques/edit-plan-over-regeneration.md` | M3 |
| 12 | **Replace the "69 % sound off" rationale.** That figure comes from muted-autoplay feeds, not shorts platforms. The burned-in captions decision stands. | 6.5 | `platform-format-adaptation/techniques/sound-off-first-design.md` | doc only |
| 13 | **Budget inconsistency:** the live test budget (≤ 20 s TTS, ≤ 10 s music) cannot voice the 45-75 s video §8 expects. Raise the budget or shorten the live e2e video. | 6.4 vs 8 | review's reading | owner |

## Gaps the design does not cover yet

- Story planning before prose: tension, question stack, and a beat list with a but/therefore test.
  No angle means no video (`narrative-engine-selection/techniques/no-engine-means-no-video.md`).
- Per-scene TTS so a note re-renders one scene, with a check on the joins (`review-iteration-loops/techniques/partial-regeneration-seams.md`).
- Refusal is a labelled state, never an empty success (`_laws.md#refusal-is-a-state`).
- Rights-record fields: account, terms date, destination cleared for.
- Asset vs disposable-render lifecycles (`production-pipeline-phasing/techniques/asset-vs-disposable-render.md`).
- Retention curves in `metrics_daily`, which is how a failed hook shows up.
- Disclosure placed on the frame, not only in metadata.
- A static lint against CSS transitions and effect-driven state in compositions, plus a
  cold-seek golden test (`production-ops/video-assembly/techniques/seek-stable-composition-authoring.md`).
- `c2pa: true` on a TTS asset probably won't survive the AAC re-encode. Record it honestly.
