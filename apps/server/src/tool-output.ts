/**
 * Output caps for tool results (DESIGN §6.6): a tool result lands in the model's context, so it is
 * bounded here at the tool layer (the warehouse's own 5000-row cap stays as the engine limit).
 * Every cut says so and tells the model how to narrow the request. No React, no DOM.
 */
export const MAX_RESULT_ROWS = 200;
export const MAX_RESULT_BYTES = 64 * 1024;

const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v), "utf8");

type RowsResult = { rows: Record<string, unknown>[]; truncated?: boolean; [k: string]: unknown };

/** Cap a query result to MAX_RESULT_ROWS rows and MAX_RESULT_BYTES; adds `truncated` and a narrowing `note`. */
export function capQueryResult<T extends RowsResult>(res: T, maxRows = MAX_RESULT_ROWS, maxBytes = MAX_RESULT_BYTES): T & { note?: string; total_rows_seen?: number } {
  const seen = res.rows.length;
  let keep = Math.min(seen, maxRows);
  const rebuild = (n: number) => ({ ...res, rows: res.rows.slice(0, n) });
  let out = rebuild(keep);
  while (keep > 1 && bytes(out) > maxBytes) {
    keep = Math.max(1, Math.floor(keep * 0.75));
    out = rebuild(keep);
  }
  if (keep >= seen) return res;
  return {
    ...out,
    truncated: true,
    total_rows_seen: seen,
    note: `Showing the first ${keep} of ${res.truncated ? `at least ${seen}` : seen} rows (cap: ${maxRows} rows / ${Math.round(maxBytes / 1024)} KB). Narrow the query: add a WHERE filter, select only the columns you need, aggregate, or ORDER BY ... LIMIT n.`,
  };
}

type ViewLike = { name: string; sample?: unknown[]; [k: string]: unknown };

/** describe_views can list every view with samples: drop samples, then views, until it fits. */
export function capViews<T extends ViewLike>(views: T[], maxBytes = MAX_RESULT_BYTES): { views: T[]; note?: string } {
  if (bytes(views) <= maxBytes) return { views };
  const bare = views.map((v) => ({ ...v, sample: [] }));
  if (bytes(bare) <= maxBytes) return { views: bare, note: "Sample rows were dropped to fit the size cap. Read a few rows with query (SELECT * FROM llm.<view> LIMIT 3), or pass sport to list fewer views." };
  const kept: T[] = [];
  for (const v of bare) {
    if (bytes([...kept, v]) > maxBytes) break;
    kept.push(v);
  }
  return { views: kept, note: `Listing cut to ${kept.length} of ${views.length} views to fit the size cap (samples dropped). Pass sport to list only that sport's views.` };
}
