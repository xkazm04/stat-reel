/**
 * What counts as a failed tool call. No fs, no spawn.
 *
 * The MCP wrapper (apps/server/src/mcp.ts `text`) flags a handler result `isError` by this rule, and the
 * ReplayEngine applies the same rule to the LIVE handler result, so replay and a live run agree on which
 * calls failed.
 */

/** A result that carries `error` (string) or a non-empty `errors` array is a failed call. */
export function isFailedToolResult(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const r = v as { error?: unknown; errors?: unknown };
  return (typeof r.error === "string" && r.error !== "") || (Array.isArray(r.errors) && r.errors.length > 0);
}

/** The same rule over a tool_result `content` string (JSON text); non-JSON text is not a failure by itself. */
export function isFailedToolContent(content: string): boolean {
  try {
    return isFailedToolResult(JSON.parse(content));
  } catch {
    return false;
  }
}
