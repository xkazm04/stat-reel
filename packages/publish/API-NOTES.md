# YouTube API notes (verified 2026-09-29)

Facts `src/youtube.ts` and `src/oauth.ts` rely on, read from the official docs on 2026-09-29.
Re-check them before M5 and whenever an upload fails in a way these notes don't explain.

## videos.insert
Source: https://developers.google.com/youtube/v3/docs/videos/insert

- `POST https://www.googleapis.com/upload/youtube/v3/videos`. `part` is required (we send `snippet,status`), and `notifySubscribers` is optional (we send `false`).
- Quota: 1 unit, charged to the separate *Video Uploads* bucket (100 calls/day).
- Media: `video/*` or `application/octet-stream`, up to 256 GB.
- **"All videos uploaded via the `videos.insert` endpoint from unverified API projects created after 28 July 2020 will be restricted to private viewing mode."** The API audit lifts this (see SETUP.md). v1 uploads private anyway.
- Fields you can set include `snippet.title`, `description`, `tags[]`, `categoryId` and `defaultLanguage`, plus `status.privacyStatus`, `embeddable`, `license`, `publicStatsViewable`, `publishAt`, `selfDeclaredMadeForKids` and **`containsSyntheticMedia`**.
- Scopes (any one of): `youtube.upload`, `youtube`, `youtubepartner`, `youtube.force-ssl`.

## Video resource
Source: https://developers.google.com/youtube/v3/docs/videos (page last updated 2026-09-16)

- **`status.containsSyntheticMedia`**: "In a `videos.insert` or `videos.update` request, this property allows the channel owner to disclose that a video contains realistic Altered or Synthetic (A/S) content." Added 2024-10-30 (https://developers.google.com/youtube/v3/revision_history). This is the API field behind the "altered or synthetic content" checkbox. We set it from `containsSyntheticMedia` (true when AI music or voice is used).
- `status.privacyStatus` takes `private`, `public` or `unlisted`. The adapter only accepts `private`.
- `status.selfDeclaredMadeForKids`: the channel owner marks the video as child-directed. We send `false`.
- `snippet.title`: at most 100 characters, no `<` or `>`. `snippet.description`: at most 5000 **bytes**, no `<` or `>`. `snippet.tags`: at most 500 characters in total, where commas count and a tag containing spaces also counts its quotes.
- `statistics` has `viewCount`, `likeCount` and `commentCount`, all strings. `favoriteCount` is always 0, and `dislikeCount` has been private since 2021-12-13.
- `status.uploadStatus` is one of `deleted`, `failed`, `processed`, `rejected` or `uploaded`.

## Resumable upload protocol
Source: https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol

1. `POST /upload/youtube/v3/videos?uploadType=resumable&part=…` with headers `Authorization: Bearer`, `Content-Length`, `Content-Type: application/json; charset=UTF-8`, `X-Upload-Content-Length` and `X-Upload-Content-Type`, and the video resource as the JSON body. The response is `200 OK`, and its `Location:` header carries the session URI.
2. `PUT <session URI>` with the bytes. When sending chunks, add `Content-Range: bytes FIRST-LAST/TOTAL`. Every chunk except the last must be a **multiple of 256 KB** (we use 8 MiB).
3. `308 Resume Incomplete` comes back with `Range: bytes=0-N`, which means we send from N+1 next. After an interruption, send an empty `PUT` with `Content-Range: bytes */TOTAL` to ask the server how far it got. `200`/`201` means the upload is done, and the body is the video resource.

Note: the guide's example sets `"privacyStatus": "public"`, and https://developers.google.com/youtube/v3/guides/uploading_a_video states "The default behavior is for an uploaded video to be publicly visible". **Always send `privacyStatus` explicitly.**

## captions.insert
Source: https://developers.google.com/youtube/v3/docs/captions/insert (last updated 2026-09-14)

- `POST https://www.googleapis.com/upload/youtube/v3/captions` with `part=snippet`. The body needs `snippet.videoId`, `snippet.language` and `snippet.name`, and can include `snippet.isDraft`.
- Quota: **400 units**. Scopes: `youtube.force-ssl` or `youtubepartner`.
- Media: `text/xml`, `application/octet-stream` or `*/*`, up to 100 MB. `sync` is deprecated.
- The docs page doesn't state which upload type to use. We send the standard Google `uploadType=multipart` with `multipart/related` (a JSON metadata part followed by the file part), which is what Google's client libraries do. **Unverified until the first live run.**

## captions.list, videos.list, videos.delete
- captions.list: `GET https://www.googleapis.com/youtube/v3/captions?part=snippet&videoId=…`, 50 units. https://developers.google.com/youtube/v3/docs/captions/list
- videos.list: `GET https://www.googleapis.com/youtube/v3/videos?part=status,statistics&id=a,b`, 1 unit. https://developers.google.com/youtube/v3/docs/videos/list. The page gives no explicit limit on how many ids one call takes. We batch 50 per call (the usual maxResults limit), which is an assumption.
- videos.delete: `DELETE https://www.googleapis.com/youtube/v3/videos?id=…`, **50 units**, returns `204 No Content`. https://developers.google.com/youtube/v3/docs/videos/delete

## Quota
Source: https://developers.google.com/youtube/v3/getting-started

- Default allocation: "100 `search.list` calls, 100 `videos.insert` calls, and 10,000 units per day combined for all other endpoints."
- One live e2e run uses about 1 upload plus 400 (caption) + 1 (get) + 50 (captions.list) + 50 (delete), roughly 500 units of the 10,000.
- Audit and quota form: https://support.google.com/youtube/contact/yt_api_form (the "YouTube Data API Services Audit and Quota Extension Form").

## YouTube Analytics reports.query
Source: https://developers.google.com/youtube/analytics/reference/reports/query

- `GET https://youtubeanalytics.googleapis.com/v2/reports`. Required: `ids` (`channel==MINE`), `startDate`, `endDate` (YYYY-MM-DD) and `metrics`. Optional: `dimensions`, `filters` (`video==ID1,ID2`), `sort` and `maxResults`.
- Scope: `yt-analytics.readonly`. The response has `columnHeaders[]` and `rows[][]`.
- Metrics we use: `views`, `estimatedMinutesWatched`, `averageViewDuration`, `likes`, `comments`, `shares`, `subscribersGained` and `subscribersLost`.
- We run one query per video with `dimensions=day` and `filters=video==ID`, because some dimension combinations aren't allowed. The `day`+`video` combination isn't verified.

## OAuth 2.0 for desktop apps
Sources: https://developers.google.com/identity/protocols/oauth2/native-app · https://developers.google.com/identity/protocols/oauth2

- Auth endpoint: `https://accounts.google.com/o/oauth2/v2/auth`. Token endpoint: `https://oauth2.googleapis.com/token`, which takes `application/x-www-form-urlencoded`.
- Auth request: `client_id`, `redirect_uri`, `response_type=code` and `scope` (space-separated), plus the recommended `code_challenge`, `code_challenge_method=S256` and `state`. `login_hint` is optional.
- Loopback redirect: `http://127.0.0.1:<port>` or `http://[::1]:<port>`. Loopback is deprecated only for the Android, Chrome app and iOS client types. The Desktop type is still supported.
- Code exchange: `client_id`, `code`, `code_verifier`, `grant_type=authorization_code` and `redirect_uri`, plus `client_secret`, which Google issues for desktop clients.
- Refresh: `client_id`, `grant_type=refresh_token`, `refresh_token` and (optionally) `client_secret`. The response has `access_token`, `expires_in`, `scope` and `token_type` (and `refresh_token` on the first exchange).
- **Refresh tokens expire after 7 days while the consent screen is External and in "Testing" status**, unless the only scopes requested are name, email and profile. Until the app is published or verified, the owner will have to reconnect every week (`invalid_grant`).

## Idempotent uploads (adapter contract)
`uploadVideo(req, { resumeSessionUri?, onSession?, expectedSha256? })`:
- `onSession(uri)` fires once per new resumable session, before any byte is sent. The caller persists it per render; after a crash it passes it back as `resumeSessionUri`, and the adapter probes it (`Content-Range: bytes */TOTAL`) and sends only the missing bytes (or returns the finished video on 200/201). Without this a retried upload creates a second private video.
- A `404`/`410` on a session (probe or chunk) means the server forgot it: the adapter creates a fresh session and re-sends, **once** (a second 404/410 throws). Fresh sessions are reported through `onSession` again, so the caller must overwrite the stored URI.
- Retried with backoff `min(64 s, max(2^n s, Retry-After))`, up to `maxRetries` (default 5): network errors, `5xx`, `429`, and `403` whose first error reason is `quotaExceeded`, `rateLimitExceeded`, `userRateLimitExceeded` or `dailyLimitExceeded`. Any other `403` (e.g. `forbidden`) fails immediately. The Video Uploads bucket is 100/day, so a quota retry that outlives the cap surfaces as a `YouTubeApiError` (status 403, reason set) for the caller to defer.
- `expectedSha256` (pass `manifest.subject.sha256`): the file is hashed as a stream (no whole-file buffer) and the upload is refused, before any request, when it differs. The same streaming hash feeds the dry-run id.
- Publish gate note: `policy/publish.rego` allows `private` only for `youtube` (this adapter throws on anything else); `draft` stays allowed for platforms with drafts (TikTok, later); `unlisted` and `public` are denied everywhere.
- Tests: `OPA_REQUIRED=1` makes `policy.test.ts` fail instead of skip when the opa binary is missing; `node scripts/check.mjs --only opa` runs `opa test policy`.
