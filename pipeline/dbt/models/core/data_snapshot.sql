-- Which immutable f1db release this warehouse was built from, read from the snapshot's own manifest.json
-- (written by ingest at fetch time): offline, no new source, no network. A table, not a view, because the
-- MCP query connection runs with external access disabled and could not read the file at query time.
select
    snapshot,
    release_tag,
    cast(release_published_at as timestamp)  as release_published_at
from read_json(
    '{{ env_var("F1DB_SNAPSHOT") }}/manifest.json',
    format = 'auto',
    columns = {snapshot: 'VARCHAR', release_tag: 'VARCHAR', release_published_at: 'VARCHAR'}
)
