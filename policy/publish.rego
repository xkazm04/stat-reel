# StatReel publish gate (DESIGN.md §6.8, amended by ADR 003).
#
# input = {"manifest": <ProvenanceManifest>, "target": <PublishTarget (+ optional description)>}
#
# FAIL CLOSED: a required piece of evidence that is missing (or not the right type) is a deny,
# never a pass. `checks_run` lists every rule this gate evaluates.
package statreel.publish

default allow := false

allow := count(deny) == 0

# Every rule name below appears in exactly one deny/warn rule (see the `# rule:` comments).
checks_run := [
	"source_not_legal_on_monetized",
	"source_verdict_avoid",
	"source_missing_classification",
	"sources_empty",
	"audio_free_plan_on_monetized",
	"audio_missing_plan_tier",
	"font_not_ofl",
	"font_not_in_allowlist",
	"fonts_empty",
	"font_fallbacks",
	"evidence_missing",
	"evidence_not_number",
	"loudness_out_of_range",
	"true_peak_too_high",
	"resolution_not_allowed",
	"fps_not_30",
	"duration_out_of_band",
	"black_frames_too_long",
	"captions_not_burned_in",
	"caption_cps_too_high",
	"safe_zone_violations",
	"ai_music_without_disclosure_flag",
	"ai_audio_without_on_frame_disclosure",
	"ai_disclosure_flag_missing",
	"disclosure_flags_contradict_audio",
	"visibility_not_private",
	"description_missing_attribution",
]

# Numeric evidence the gate cannot pass without.
required_evidence := [
	"captions.max_cps",
	"checks.safe_zone_violations",
	"checks.loudness_lufs",
	"checks.true_peak_dbtp",
	"checks.font_fallbacks",
	"checks.width",
	"checks.height",
	"checks.fps",
	"checks.duration_s",
	"checks.black_frames_s",
]

# Delivery format (DESIGN §3 D16 / §6.1: 30-90 s videos; §6.3: 1080x1920 vertical or 1920x1080 landscape, 30 fps).
allowed_resolutions := [[1080, 1920], [1920, 1080]]

target_fps := 30

duration_band_s := {"min": 30, "max": 90}

# blackdetect runs at d=0.5 s, so a single detected stretch is already >= 0.5 s; more than 1 s in total is a defect.
max_black_s := 1

# v1 publishes private only on YouTube (the adapter has no draft concept and never sends anything
# else); `draft` is kept for platforms whose adapters create drafts (TikTok, later). Everything else
# - unlisted, public, a missing/unknown platform - needs the owner's explicit approval.
allowed_visibility("youtube") := {"private"}

allowed_visibility(platform) := {"private", "draft"} if platform in {"tiktok", "instagram"}

default allowed_visibility(_) := {"private"}

# ------------------------------------------------------------------ helpers

_missing := "__statreel_missing__"

# has_path(x, ["a", "b"]) is true when x.a.b exists and is not null.
has_path(x, path) if {
	v := object.get(x, path, _missing)
	v != _missing
	v != null
}

evidence(f) := object.get(input.manifest, split(f, "."), null)

# Unknown/missing `monetized` is treated as monetized (fail closed).
monetized if input.target.monetized != false

monetized if not has_path(input, ["target", "monetized"])

sources := object.get(input.manifest, ["data", "sources"], [])

audio := object.get(input.manifest, "audio", [])

fonts := object.get(input.manifest, "fonts", [])

# Allow-list of {family, sha256} generated from fonts/fonts.manifest.json (policy/fonts_allow.json;
# a test pins it to the manifest). Missing data means an empty list: every font is denied.
default fonts_allow := []

fonts_allow := data.statreel.fonts_allow

font_allowed(f) if {
	some a in fonts_allow
	a.family == f.family
	a.sha256 == f.sha256
}

valid_plan_tier(a) if {
	is_string(a.plan_tier)
	a.plan_tier != ""
}

# ------------------------------------------------------------------ data rights

# rule: source_not_legal_on_monetized
deny contains msg if {
	monetized
	some s in sources
	object.get(s, "license_class", "unknown") != "legal"
	msg := sprintf("source %s is %s: not allowed on a monetized channel", [object.get(s, "id", "<unknown>"), object.get(s, "license_class", "unknown")])
}

# rule: source_verdict_avoid
deny contains msg if {
	some s in sources
	s.verdict == "avoid"
	msg := sprintf("source %s has verdict avoid", [object.get(s, "id", "<unknown>")])
}

# rule: source_missing_classification
deny contains msg if {
	some s in sources
	some field in ["id", "license_class", "verdict"]
	not has_path(s, [field])
	msg := sprintf("source %s has no %s", [object.get(s, "id", "<unknown>"), field])
}

# rule: sources_empty
deny contains "no data sources recorded" if count(sources) == 0

# ------------------------------------------------------------------ audio rights

# rule: audio_free_plan_on_monetized
deny contains msg if {
	monetized
	some a in audio
	a.plan_tier == "free"
	msg := sprintf("%s audio generated on free plan (non-commercial)", [object.get(a, "kind", "unknown")])
}

# rule: audio_missing_plan_tier
deny contains msg if {
	some a in audio
	not valid_plan_tier(a)
	msg := sprintf("%s audio has no plan_tier", [object.get(a, "kind", "unknown")])
}

# ------------------------------------------------------------------ fonts

# rule: font_not_ofl
deny contains msg if {
	some f in fonts
	object.get(f, "license", "unknown") != "OFL-1.1"
	msg := sprintf("font %s is not OFL", [object.get(f, "family", "<unknown>")])
}

# rule: font_not_in_allowlist
# A manifest that says "OFL-1.1" proves nothing by itself: the family and file hash must be one
# the repo actually ships (fonts/fonts.manifest.json), so a lying manifest cannot pass.
deny contains msg if {
	some f in fonts
	not font_allowed(f)
	msg := sprintf("font %s (sha256 %s) is not in the shipped-font allow-list", [object.get(f, "family", "<unknown>"), object.get(f, "sha256", "<none>")])
}

# rule: fonts_empty
deny contains "no fonts recorded" if count(fonts) == 0

# rule: font_fallbacks
deny contains msg if {
	n := evidence("checks.font_fallbacks")
	is_number(n)
	n > 0
	msg := sprintf("font fallbacks detected: %v", [n])
}

# ------------------------------------------------------------------ measured evidence (ADR 003)

# rule: evidence_missing
deny contains sprintf("missing evidence: %s", [f]) if {
	some f in required_evidence
	not has_path(input.manifest, split(f, "."))
}

# rule: evidence_not_number
deny contains sprintf("invalid evidence: %s is not a number", [f]) if {
	some f in required_evidence
	has_path(input.manifest, split(f, "."))
	not is_number(evidence(f))
}

# rule: loudness_out_of_range
deny contains "loudness outside -14 LUFS +/-1" if {
	l := evidence("checks.loudness_lufs")
	is_number(l)
	abs(l + 14) > 1
}

# rule: true_peak_too_high
deny contains "true peak above -2 dBTP" if {
	tp := evidence("checks.true_peak_dbtp")
	is_number(tp)
	tp > -2
}

# rule: resolution_not_allowed
deny contains "resolution is not 1080x1920 (vertical) or 1920x1080 (landscape)" if {
	w := evidence("checks.width")
	h := evidence("checks.height")
	is_number(w)
	is_number(h)
	not [w, h] in allowed_resolutions
}

# rule: fps_not_30
deny contains "frame rate is not 30 fps" if {
	f := evidence("checks.fps")
	is_number(f)
	abs(f - target_fps) > 0.01
}

# rule: duration_out_of_band
deny contains "duration outside the 30-90 s band" if {
	d := evidence("checks.duration_s")
	is_number(d)
	d < duration_band_s.min
}

deny contains "duration outside the 30-90 s band" if {
	d := evidence("checks.duration_s")
	is_number(d)
	d > duration_band_s.max
}

# rule: black_frames_too_long
deny contains "black frames longer than 1 s" if {
	b := evidence("checks.black_frames_s")
	is_number(b)
	b > max_black_s
}

# ------------------------------------------------------------------ captions + safe zone

# rule: captions_not_burned_in
deny contains "captions not burned in" if not input.manifest.captions.burned_in == true

# rule: caption_cps_too_high
deny contains "caption reading speed above 20 CPS" if {
	cps := evidence("captions.max_cps")
	is_number(cps)
	cps > 20
}

# rule: safe_zone_violations
deny contains "safe-zone violations" if {
	n := evidence("checks.safe_zone_violations")
	is_number(n)
	n > 0
}

# ------------------------------------------------------------------ disclosure

# rule: ai_music_without_disclosure_flag
deny contains "AI music used but disclosure flag not set" if {
	some a in audio
	a.kind == "music"
	not input.target.ai_disclosure == true
}

# rule: ai_audio_without_on_frame_disclosure
deny contains "AI audio used but disclosure not placed on the frame" if {
	count(audio) > 0
	not input.manifest.disclosure.on_frame == true
}

# rule: ai_disclosure_flag_missing
# The manifest says AI voice/music is in the video: the platform-side disclosure must be set.
deny contains "manifest declares AI audio but target.ai_disclosure is not set" if {
	some flag in ["ai_voice", "ai_music"]
	input.manifest.disclosure[flag] == true
	not input.target.ai_disclosure == true
}

# rule: disclosure_flags_contradict_audio
# Generated audio assets present while the manifest's disclosure flag for that kind is not true.
deny contains msg if {
	some a in audio
	kind := object.get(a, "kind", "unknown")
	flag := {"tts": "ai_voice", "music": "ai_music"}[kind]
	not input.manifest.disclosure[flag] == true
	msg := sprintf("%s audio present but disclosure.%s is not true", [kind, flag])
}

# ------------------------------------------------------------------ visibility

# rule: visibility_not_private
deny contains msg if {
	v := object.get(input, ["target", "visibility"], "<missing>")
	platform := object.get(input, ["target", "platform"], "<missing>")
	not v in allowed_visibility(platform)
	msg := sprintf("visibility %v on %v requires owner approval: v1 publishes private only (draft only where the platform has drafts)", [v, platform])
}

# ------------------------------------------------------------------ warnings

# rule: description_missing_attribution
# The description is auto-appended with attributions upstream; the gate can only warn if a
# human edit removed one.
warn contains msg if {
	d := input.target.description
	is_string(d)
	some s in sources
	is_string(s.attribution)
	not contains(d, s.attribution)
	msg := sprintf("description is missing attribution for source %s: %q", [object.get(s, "id", "<unknown>"), s.attribution])
}
