/** Sample objects shared by tests and replay fixtures. Figures mirror the real f1db mart (2026-09-29). */

const k = (id: string, col: string) => `f1db:driver:${id}:era-adjusted#${col}`;
const row = (id: string, name: string, rr: number, ar: number, rv: number, av: number) => ({
  player_id: id, name, raw_rank: rr, adjusted_rank: ar, raw_value: rv, adjusted_value: av,
  raw_rank_fact_key: k(id, "rank_raw"), adjusted_rank_fact_key: k(id, "rank_adjusted"),
  raw_fact_key: k(id, "points_awarded"), adjusted_fact_key: k(id, "points_per_start_current_system"),
});

export const sampleEraProps = {
  format: "vertical" as const,
  hook_shape: "contradiction" as const,
  title: "Most points ≠ most dominant",
  metric_raw_label: "Career points (as awarded)",
  metric_adjusted_label: "Points per start (today's system)",
  rows: [
    row("juan-manuel-fangio", "Juan Manuel Fangio", 43, 1, 277.64, 17.118),
    row("alberto-ascari", "Alberto Ascari", 73, 2, 140.14, 14.29),
    row("max-verstappen", "Max Verstappen", 2, 3, 3452.5, 13.859),
    row("lewis-hamilton", "Lewis Hamilton", 1, 4, 5134.5, 13.846),
    row("michael-schumacher", "Michael Schumacher", 10, 6, 1566, 12.712),
    row("ayrton-senna", "Ayrton Senna", 22, 8, 614, 11.683),
  ],
  highlight_player_id: "juan-manuel-fangio",
  scenes: [
    { id: "hook", kind: "hook" as const, on_screen: "Most points ≠ most dominant", focus: [] },
    { id: "context", kind: "context" as const, on_screen: "Career points, as awarded", focus: ["lewis-hamilton", "max-verstappen"] },
    { id: "reveal", kind: "reveal" as const, on_screen: "Re-scored per start", focus: ["juan-manuel-fangio"] },
    { id: "payoff", kind: "payoff" as const, on_screen: "43rd → 1st", focus: ["juan-manuel-fangio"] },
    { id: "close", kind: "close" as const, on_screen: "Most points, or most dominant?", focus: [] },
  ],
  attribution: "Data: F1DB (CC BY 4.0)",
  method_note: "Era-adjusted: every race re-scored with today's points, per start. Indy 500 excluded.",
  show_safe_zone: false,
};

export const sampleScript = {
  scenes: [
    { scene_id: "hook", tokens: [
      { display: "The", spoken: "The" }, { display: "most", spoken: "most" }, { display: "dominant", spoken: "dominant" },
      { display: "driver", spoken: "driver" }, { display: "won", spoken: "won" },
      { display: "24", spoken: "twenty-four", fact_key: "f1db:driver:juan-manuel-fangio:era-adjusted#wins" },
      { display: "races.", spoken: "races." },
    ] },
  ],
  pronunciations: { "Räikkönen": "RYE-koh-nen" },
};

export const sampleManifest = {
  subject: { file: "video.mp4", sha256: "a".repeat(64) },
  build: { git_sha: "abc123", composition: "EraAdjustedSlope@0.1.0", props_sha256: "b".repeat(64), renderer: "remotion@4.0.530" },
  data: {
    models: ["mart_era_adjusted"], license_class: "legal",
    sources: [{ id: "f1db", snapshot: "2026-09-29T19:06:15Z", license: "CC-BY-4.0", license_class: "legal", verdict: "legal", attribution: "Data: F1DB (CC BY 4.0)" }],
    facts_cited: ["f1db:driver:juan-manuel-fangio:era-adjusted#rank_adjusted"],
  },
  audio: [
    { kind: "tts" as const, provider: "elevenlabs" as const, model_id: "eleven_multilingual_v2", voice_id: "v", plan_tier: "starter" as const, generated_at: "2026-09-29T20:00:00Z", sha256: "c".repeat(64), scene_id: "hook" },
    { kind: "music" as const, provider: "elevenlabs" as const, model_id: "music_v1", prompt_sha256: "d".repeat(64), plan_tier: "starter" as const, generated_at: "2026-09-29T20:00:00Z", sha256: "e".repeat(64) },
  ],
  fonts: [{ family: "Barlow Condensed", license: "OFL-1.1", sha256: "f".repeat(64) }],
  captions: { burned_in: true, sidecar: ["captions.srt", "captions.vtt"], max_cps: 17.2 },
  checks: { loudness_lufs: -14.1, true_peak_dbtp: -2.3, loudness_range_lu: 6.1, safe_zone_violations: 0, font_fallbacks: 0,
    width: 1080, height: 1920, fps: 30, duration_s: 58.2, video_codec: "h264", audio_codec: "aac", black_frames_s: 0 },
  llm: { engine: "claude-code", session_id: "s-1" },
  disclosure: { ai_voice: true, ai_music: true, on_frame: true },
};
