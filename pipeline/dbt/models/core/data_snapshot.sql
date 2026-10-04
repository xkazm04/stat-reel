-- Which immutable f1db release this warehouse was built from, read from the snapshot's own manifest.json
-- (written by ingest at fetch time, declared as the f1db source table snapshot_manifest): offline, no
-- network. A table, not a view, because the MCP query connection runs with external access disabled and
-- could not read the file at query time.
select
    snapshot,
    release_tag,
    cast(release_published_at as timestamp)  as release_published_at
from {{ source('f1db', 'snapshot_manifest') }}
