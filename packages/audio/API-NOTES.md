# ElevenLabs API facts relied on by `@statreel/audio`

Checked 2026-09-29 against the official docs (read only; no live calls, no credits spent).

## Auth: https://elevenlabs.io/docs/api-reference/authentication
- Header `xi-api-key: <key>`. Base URL `https://api.elevenlabs.io`.

## TTS with timestamps: https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps
- `POST /v1/text-to-speech/{voice_id}/with-timestamps?output_format=mp3_44100_128` (the default is `mp3_44100_128`; we always send it so the cache key pins it).
- Body fields we send: `text` (required), `model_id`, `voice_settings` {`stability`, `similarity_boost`, `style`, `use_speaker_boost`, `speed`}, `seed`, `language_code`.
- Response JSON: `audio_base64` (string), `alignment` {`characters[]`, `character_start_times_seconds[]`, `character_end_times_seconds[]`} (nullable in the docs: we treat null as a `ProviderError`), `normalized_alignment` (same shape, optional).
- Response header `request-id`. Source: https://elevenlabs.io/docs/developers/guides/cookbooks/text-to-speech/request-stitching

## Music compose: https://elevenlabs.io/docs/api-reference/music/compose
- `POST /v1/music?output_format=mp3_44100_128`. The response is binary audio.
- Body: `prompt` XOR `composition_plan`; `music_length_ms` is an integer from 3000 to 600000 and is **prompt-only**; `force_instrumental` is **prompt-only**; `model_id` ∈ `music_v1` (API default), `music_v2`, `music_v2_5`. We default to `music_v2` per DESIGN §6.4.
- `composition_plan`: `positive_global_styles[]`, `negative_global_styles[]`, `sections[]` {`section_name` (1–100 chars), `positive_local_styles[]`, `negative_local_styles[]`, `duration_ms` (3000–120000), `lines[]`}. With a plan we send no length or instrumental flag. We require that the section durations sum to the cue length and that every `lines` list is empty.
- No response header is documented for music; we read `request-id` if the API sends it.

## Forced alignment: https://elevenlabs.io/docs/api-reference/forced-alignment/create
- `POST /v1/forced-alignment` as `multipart/form-data` with `file` (audio) and `text`.
- Response: `characters[]` {`text`, `start`, `end`}, `words[]` {`text`, `start`, `end`, `loss`}, `loss`.

## Subscription: https://elevenlabs.io/docs/api-reference/user/subscription/get
- `GET /v1/user/subscription` returns `tier` (string; example values `free`, `starter`, `creator`, `pro`, `enterprise`, `trial`), `character_count`, `character_limit`, `status`, `next_character_count_reset_unix`.

## Errors: https://elevenlabs.io/docs/developers/resources/errors
- Body shape `{ "detail": { type, code, message, status (legacy), request_id, param } }`. A 422 returns `detail` as an array of `{loc, msg, type}`.
- 401 `authentication_error` means an auth failure. 402 `insufficient_credits` means quota. 429 `rate_limit_exceeded` / `concurrent_limit_exceeded` means back off.
- **Not documented:** content-policy and moderation refusal codes. We classify a 4xx as `AudioRefused` when type/code/status/message matches a policy pattern (`bad_prompt`, moderation, content policy, copyright, …). `prompt_suggestion` (under `detail.data`, from older music API behaviour) is carried when present. The legacy `401 {status:"quota_exceeded"}` maps to `QuotaError`.
