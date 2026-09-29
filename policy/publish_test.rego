# Tests for policy/publish.rego. Every deny rule has a negative case (the valid sample → no
# such deny) and a positive case (a mutated input → that deny message).
package statreel.publish_test

import data.statreel.publish

# Mirrors sampleManifest in packages/schemas/src/fixtures.ts.
sample_manifest := {
	"subject": {"file": "video.mp4", "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
	"build": {"git_sha": "abc123", "composition": "EraAdjustedSlope@0.1.0", "props_sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "renderer": "remotion@4.0.530"},
	"data": {
		"models": ["mart_era_adjusted"],
		"license_class": "legal",
		"sources": [{
			"id": "f1db", "snapshot": "2026-09-29T19:06:15Z", "license": "CC-BY-4.0",
			"license_class": "legal", "verdict": "legal", "attribution": "Data: F1DB (CC BY 4.0)",
		}],
		"facts_cited": ["f1db:driver:juan-manuel-fangio:era-adjusted#rank_adjusted"],
	},
	"audio": [
		{
			"kind": "tts", "provider": "elevenlabs", "model_id": "eleven_multilingual_v2", "voice_id": "v",
			"plan_tier": "starter", "generated_at": "2026-09-29T20:00:00Z", "sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc", "scene_id": "hook",
		},
		{
			"kind": "music", "provider": "elevenlabs", "model_id": "music_v1", "prompt_sha256": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
			"plan_tier": "starter", "generated_at": "2026-09-29T20:00:00Z", "sha256": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
		},
	],
	"fonts": [{"family": "Barlow Condensed", "license": "OFL-1.1", "sha256": "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"}],
	"captions": {"burned_in": true, "sidecar": ["captions.srt", "captions.vtt"], "max_cps": 17.2},
	"checks": {
		"loudness_lufs": -14.1, "true_peak_dbtp": -2.3, "loudness_range_lu": 6.1, "safe_zone_violations": 0,
		"font_fallbacks": 0, "width": 1080, "height": 1920, "fps": 30, "duration_s": 58.2,
		"video_codec": "h264", "audio_codec": "aac", "black_frames_s": 0,
	},
	"llm": {"engine": "claude-code", "session_id": "s-1"},
	"disclosure": {"ai_voice": true, "ai_music": true, "on_frame": true},
}

sample_target := {"platform": "youtube", "monetized": true, "ai_disclosure": true, "visibility": "private"}

base := {"manifest": sample_manifest, "target": sample_target}

patched(ops) := json.patch(base, ops)

replace(path, value) := patched([{"op": "replace", "path": path, "value": value}])

remove(path) := patched([{"op": "remove", "path": path}])

non_commercial_source := {
	"id": "fbref", "snapshot": "2026-09-29T00:00:00Z", "license": "proprietary",
	"license_class": "non_commercial", "verdict": "non_commercial", "attribution": "Data: FBref",
}

denies(inp, msg) if msg in publish.deny with input as inp

# ------------------------------------------------------------------ overall

test_valid_sample_allowed if {
	publish.allow with input as base
}

test_valid_sample_has_no_denies if {
	count(publish.deny) == 0 with input as base
}

test_valid_sample_has_no_warns if {
	count(publish.warn) == 0 with input as base
}

test_any_deny_blocks_allow if {
	not publish.allow with input as replace("/manifest/captions/max_cps", 25)
}

test_empty_input_denied if {
	not publish.allow with input as {}
}

test_checks_run_lists_every_rule if {
	count(publish.checks_run) == 20
	"evidence_missing" in publish.checks_run
	"visibility_not_private" in publish.checks_run
	"description_missing_attribution" in publish.checks_run
}

# ------------------------------------------------------------------ source_not_legal_on_monetized

msg_nc := "source fbref is non_commercial: not allowed on a monetized channel"

test_source_not_legal_negative if not denies(base, msg_nc)

test_source_not_legal_positive if denies(replace("/manifest/data/sources", [non_commercial_source]), msg_nc)

test_source_not_legal_ok_when_not_monetized if {
	inp := patched([
		{"op": "replace", "path": "/manifest/data/sources", "value": [non_commercial_source]},
		{"op": "replace", "path": "/target/monetized", "value": false},
	])
	not denies(inp, msg_nc)
}

test_source_not_legal_missing_monetized_is_monetized if {
	inp := patched([
		{"op": "replace", "path": "/manifest/data/sources", "value": [non_commercial_source]},
		{"op": "remove", "path": "/target/monetized"},
	])
	denies(inp, msg_nc)
}

# ------------------------------------------------------------------ source_verdict_avoid

test_source_verdict_avoid_negative if not denies(base, "source f1db has verdict avoid")

test_source_verdict_avoid_positive if {
	denies(replace("/manifest/data/sources/0/verdict", "avoid"), "source f1db has verdict avoid")
}

test_source_verdict_avoid_even_when_not_monetized if {
	inp := patched([
		{"op": "replace", "path": "/manifest/data/sources/0/verdict", "value": "avoid"},
		{"op": "replace", "path": "/target/monetized", "value": false},
	])
	denies(inp, "source f1db has verdict avoid")
}

# ------------------------------------------------------------------ source_missing_classification

test_source_missing_classification_negative if not denies(base, "source f1db has no verdict")

test_source_missing_classification_positive if {
	denies(remove("/manifest/data/sources/0/verdict"), "source f1db has no verdict")
}

test_source_missing_license_class_positive if {
	inp := remove("/manifest/data/sources/0/license_class")
	denies(inp, "source f1db has no license_class")
	denies(inp, "source f1db is unknown: not allowed on a monetized channel")
}

# ------------------------------------------------------------------ sources_empty

test_sources_empty_negative if not denies(base, "no data sources recorded")

test_sources_empty_positive if denies(replace("/manifest/data/sources", []), "no data sources recorded")

test_sources_missing_positive if denies(remove("/manifest/data/sources"), "no data sources recorded")

# ------------------------------------------------------------------ audio_free_plan_on_monetized

test_audio_free_plan_negative if not denies(base, "music audio generated on free plan (non-commercial)")

test_audio_free_plan_positive if {
	denies(replace("/manifest/audio/1/plan_tier", "free"), "music audio generated on free plan (non-commercial)")
}

test_audio_free_plan_ok_when_not_monetized if {
	inp := patched([
		{"op": "replace", "path": "/manifest/audio/1/plan_tier", "value": "free"},
		{"op": "replace", "path": "/target/monetized", "value": false},
	])
	not denies(inp, "music audio generated on free plan (non-commercial)")
}

# ------------------------------------------------------------------ audio_missing_plan_tier

test_audio_missing_plan_tier_negative if not denies(base, "tts audio has no plan_tier")

test_audio_missing_plan_tier_positive if denies(remove("/manifest/audio/0/plan_tier"), "tts audio has no plan_tier")

test_audio_empty_plan_tier_positive if denies(replace("/manifest/audio/0/plan_tier", ""), "tts audio has no plan_tier")

# ------------------------------------------------------------------ font_not_ofl

test_font_not_ofl_negative if not denies(base, "font Barlow Condensed is not OFL")

test_font_not_ofl_positive if {
	denies(replace("/manifest/fonts/0/license", "proprietary"), "font Barlow Condensed is not OFL")
}

test_font_missing_license_positive if {
	denies(remove("/manifest/fonts/0/license"), "font Barlow Condensed is not OFL")
}

# ------------------------------------------------------------------ fonts_empty

test_fonts_empty_negative if not denies(base, "no fonts recorded")

test_fonts_empty_positive if denies(replace("/manifest/fonts", []), "no fonts recorded")

test_fonts_missing_positive if denies(remove("/manifest/fonts"), "no fonts recorded")

# ------------------------------------------------------------------ font_fallbacks

test_font_fallbacks_negative if not denies(base, "font fallbacks detected: 2")

test_font_fallbacks_positive if denies(replace("/manifest/checks/font_fallbacks", 2), "font fallbacks detected: 2")

# ------------------------------------------------------------------ evidence_missing (one per field)

test_evidence_missing_negative if {
	not denies(base, "missing evidence: captions.max_cps")
	not denies(base, "missing evidence: checks.safe_zone_violations")
	not denies(base, "missing evidence: checks.loudness_lufs")
	not denies(base, "missing evidence: checks.true_peak_dbtp")
	not denies(base, "missing evidence: checks.font_fallbacks")
}

test_evidence_missing_max_cps_positive if {
	denies(remove("/manifest/captions/max_cps"), "missing evidence: captions.max_cps")
}

test_evidence_missing_safe_zone_positive if {
	denies(remove("/manifest/checks/safe_zone_violations"), "missing evidence: checks.safe_zone_violations")
}

test_evidence_missing_loudness_positive if {
	denies(remove("/manifest/checks/loudness_lufs"), "missing evidence: checks.loudness_lufs")
}

test_evidence_missing_true_peak_positive if {
	denies(remove("/manifest/checks/true_peak_dbtp"), "missing evidence: checks.true_peak_dbtp")
}

test_evidence_missing_font_fallbacks_positive if {
	denies(remove("/manifest/checks/font_fallbacks"), "missing evidence: checks.font_fallbacks")
}

test_evidence_null_is_missing if {
	denies(replace("/manifest/checks/loudness_lufs", null), "missing evidence: checks.loudness_lufs")
}

test_evidence_missing_whole_checks_block if {
	inp := remove("/manifest/checks")
	denies(inp, "missing evidence: checks.loudness_lufs")
	denies(inp, "missing evidence: checks.true_peak_dbtp")
	denies(inp, "missing evidence: checks.safe_zone_violations")
	not publish.allow with input as inp
}

# ------------------------------------------------------------------ evidence_not_number

test_evidence_not_number_negative if not denies(base, "invalid evidence: checks.loudness_lufs is not a number")

test_evidence_not_number_positive if {
	denies(replace("/manifest/checks/loudness_lufs", "-14"), "invalid evidence: checks.loudness_lufs is not a number")
}

# ------------------------------------------------------------------ loudness_out_of_range

test_loudness_negative if not denies(base, "loudness outside -14 LUFS +/-1")

test_loudness_too_loud_positive if denies(replace("/manifest/checks/loudness_lufs", -12.5), "loudness outside -14 LUFS +/-1")

test_loudness_too_quiet_positive if denies(replace("/manifest/checks/loudness_lufs", -15.5), "loudness outside -14 LUFS +/-1")

test_loudness_edge_ok if not denies(replace("/manifest/checks/loudness_lufs", -15), "loudness outside -14 LUFS +/-1")

# ------------------------------------------------------------------ true_peak_too_high

test_true_peak_negative if not denies(base, "true peak above -2 dBTP")

test_true_peak_positive if denies(replace("/manifest/checks/true_peak_dbtp", -1.3), "true peak above -2 dBTP")

test_true_peak_edge_ok if not denies(replace("/manifest/checks/true_peak_dbtp", -2), "true peak above -2 dBTP")

# ------------------------------------------------------------------ captions_not_burned_in

test_captions_not_burned_in_negative if not denies(base, "captions not burned in")

test_captions_not_burned_in_positive if denies(replace("/manifest/captions/burned_in", false), "captions not burned in")

test_captions_burned_in_missing_positive if denies(remove("/manifest/captions/burned_in"), "captions not burned in")

# ------------------------------------------------------------------ caption_cps_too_high

test_caption_cps_negative if not denies(base, "caption reading speed above 20 CPS")

test_caption_cps_positive if denies(replace("/manifest/captions/max_cps", 20.5), "caption reading speed above 20 CPS")

# ------------------------------------------------------------------ safe_zone_violations

test_safe_zone_negative if not denies(base, "safe-zone violations")

test_safe_zone_positive if denies(replace("/manifest/checks/safe_zone_violations", 1), "safe-zone violations")

# ------------------------------------------------------------------ ai_music_without_disclosure_flag

test_ai_music_disclosure_negative if not denies(base, "AI music used but disclosure flag not set")

test_ai_music_disclosure_positive if {
	denies(replace("/target/ai_disclosure", false), "AI music used but disclosure flag not set")
}

test_ai_music_disclosure_missing_positive if {
	denies(remove("/target/ai_disclosure"), "AI music used but disclosure flag not set")
}

test_ai_music_disclosure_not_needed_without_music if {
	inp := patched([
		{"op": "remove", "path": "/manifest/audio/1"},
		{"op": "replace", "path": "/target/ai_disclosure", "value": false},
	])
	not denies(inp, "AI music used but disclosure flag not set")
}

# ------------------------------------------------------------------ ai_audio_without_on_frame_disclosure

msg_on_frame := "AI audio used but disclosure not placed on the frame"

test_on_frame_negative if not denies(base, msg_on_frame)

test_on_frame_positive if denies(replace("/manifest/disclosure/on_frame", false), msg_on_frame)

test_on_frame_missing_disclosure_positive if denies(remove("/manifest/disclosure"), msg_on_frame)

test_on_frame_not_needed_without_audio if not denies(replace("/manifest/audio", []), msg_on_frame)

# ------------------------------------------------------------------ visibility_not_private

msg_public := "visibility public requires owner approval: v1 publishes private/draft only"

test_visibility_negative if not denies(base, msg_public)

test_visibility_draft_ok if {
	count([m | some m in publish.deny; contains(m, "visibility")]) == 0 with input as replace("/target/visibility", "draft")
}

test_visibility_public_positive if denies(replace("/target/visibility", "public"), msg_public)

test_visibility_unlisted_positive if {
	denies(replace("/target/visibility", "unlisted"), "visibility unlisted requires owner approval: v1 publishes private/draft only")
}

test_visibility_missing_positive if {
	denies(remove("/target/visibility"), "visibility <missing> requires owner approval: v1 publishes private/draft only")
}

# ------------------------------------------------------------------ warn: description_missing_attribution

msg_attr := "description is missing attribution for source f1db: \"Data: F1DB (CC BY 4.0)\""

test_warn_attribution_present_negative if {
	inp := json.patch(base, [{"op": "add", "path": "/target/description", "value": "Era-adjusted F1.\n\nData: F1DB (CC BY 4.0)"}])
	not msg_attr in publish.warn with input as inp
}

test_warn_attribution_removed_positive if {
	inp := json.patch(base, [{"op": "add", "path": "/target/description", "value": "Era-adjusted F1, no credits."}])
	msg_attr in publish.warn with input as inp
	publish.allow with input as inp
}
