# 001 - f1db is fetched through the GitHub Releases API, not the release download URL

- Status: accepted
- Date: 2026-09-29
- Affects: DESIGN.md §5.1 (f1db `access`), §5.2 (robots), §10 M1

## Context

DESIGN.md seeds f1db as `access: bulk_download` from its GitHub releases. The natural URL,
`https://github.com/f1db/f1db/releases/download/<tag>/f1db-csv.zip`, is **disallowed** for generic
agents by `github.com/robots.txt` (`Disallow: /*/download` under `User-agent: *`; verified with
protego against `StatReel/0.1.0 (+…)` on 2026-09-29). The ethics layer obeys robots.txt, so that
URL can't be used. GitHub's robots.txt also points automated clients at its API.

## Decision

- f1db `access: api`, `hosts: [api.github.com, release-assets.githubusercontent.com]`.
- `GET /repos/f1db/f1db/releases/latest` (ETag-conditional, so an unchanged release costs one
  304 response and no rate-limit quota), then
  `GET /repos/f1db/f1db/releases/assets/{id}` with `Accept: application/octet-stream`. That call
  redirects to `release-assets.githubusercontent.com`. `api.github.com` and
  `release-assets.githubusercontent.com` both answer 404 for robots.txt, which means no
  restrictions (RFC 9309).
- Every redirect hop is re-checked against the registry host list and robots. The asset is
  verified against the API's per-asset `digest` (sha256) before a snapshot is written, so
  `checksums_sha256.txt` is never downloaded.
- Rate: the published unauthenticated limit is 60 requests/hour, so the client runs at one request
  per 120 s per host. It counts robots.txt fetches. A fresh ingest takes about 6 minutes of
  deliberate spacing. A no-change rerun takes about 2 minutes.
- Signed redirect URLs are logged without their query string, because they carry short-lived
  credentials.

## Consequences

- Idempotent: when the release tag is unchanged there is no download and no new snapshot. In practice
  `releases/latest` answers 200 even with `If-None-Match`, because the release JSON embeds per-asset
  download counts that change its ETag; the tag comparison is what makes a rerun free. Measured
  2026-09-29: rerun = 2 requests (robots.txt + latest), 0 downloads.
- Only first-hop responses are cached. Signed redirect targets are single-use and carry credentials,
  so they are neither cached nor logged with their query string.
- The same pattern (API + registered redirect host) applies to the other GitHub-hosted sources
  (SkillCorner, Metrica, openfootball, StatsBomb) in M2.
- If GitHub ever publishes a robots.txt on the API or asset hosts, the client will obey it
  automatically.
