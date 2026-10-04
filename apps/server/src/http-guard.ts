/**
 * Localhost guard (DESIGN §3, security): the server binds 127.0.0.1 but a web page the owner visits can
 * still reach it - a "simple" cross-origin POST (text/plain) needs no CORS preflight, and DNS rebinding
 * points a foreign hostname at 127.0.0.1. The guard wraps the app's fetch (app.ts untouched):
 *  - Host must be a loopback name on the server's own port or a studio origin's port (the Vite proxy
 *    keeps the studio's Host, changeOrigin false) - else 403 (DNS rebinding);
 *  - mutating methods carrying an Origin need it in the allowlist (own origin + studio origins);
 *  - mutating methods without an Origin (local `claude` CLI -> /mcp, the generation worker's callbacks)
 *    must not be browser-simple: a body needs `application/json`;
 *  - every response gets `x-content-type-options: nosniff`.
 * Studio origins: STATREEL_ALLOWED_ORIGINS (comma list, added to the defaults) or, for the e2e's
 * overridable ports, STATREEL_STUDIO_PORT / E2E_STUDIO_PORT (default 5173).
 */
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const LOOPBACK = ["127.0.0.1", "localhost"];

export type GuardOptions = { port: number; env?: Record<string, string | undefined> };

/**
 * Built once at boot (serve.ts), so a malformed value stops the server with the key's name: a
 * scheme-less origin would otherwise never match (a silent 403) or throw in `new URL` on every request
 * whose Host falls through to it (a 500 per request).
 */
export function allowedOrigins(port: number, env: Record<string, string | undefined> = process.env): Set<string> {
  // an empty value counts as unset (as in config.ts)
  const portKey = (["STATREEL_STUDIO_PORT", "E2E_STUDIO_PORT"] as const).find((k) => env[k]?.trim());
  const studioPort = portKey ? (env[portKey] as string).trim() : "5173";
  if (!/^\d{1,5}$/.test(studioPort) || Number(studioPort) < 1 || Number(studioPort) > 65535)
    throw new Error(`${portKey} must be a port number 1-65535 (got ${JSON.stringify(studioPort)})`);
  const out = new Set<string>();
  for (const h of LOOPBACK) {
    out.add(`http://${h}:${port}`);
    out.add(`http://${h}:${studioPort}`);
  }
  for (const raw of (env.STATREEL_ALLOWED_ORIGINS ?? "").split(",")) {
    const o = raw.trim().replace(/\/+$/, "");
    if (!o) continue;
    let u: URL | undefined;
    try {
      u = new URL(o);
    } catch {
      /* reported below */
    }
    const isOrigin = !!u && (u.protocol === "http:" || u.protocol === "https:") && u.pathname === "/" && !u.search && !u.hash && !u.username && !u.password;
    if (!u || !isOrigin) throw new Error(`STATREEL_ALLOWED_ORIGINS entries must be origins like http://127.0.0.1:3000 (got ${JSON.stringify(raw.trim())})`);
    out.add(u.origin); // the browser's own serialization (lower-case host, default port dropped)
  }
  return out;
}

const isJson = (ct: string | null) => !!ct && /^application\/(.+\+)?json\s*(;|$)/i.test(ct.trim());

/** Returns a rejection reason, or null when the request may proceed. */
export function checkRequest(req: Request, origins: Set<string>): string | null {
  const host = (req.headers.get("host") ?? new URL(req.url).host).toLowerCase();
  const m = /^(127\.0\.0\.1|localhost):(\d+)$/.exec(host);
  const hostOk = !!m && [...origins].some((o) => o.toLowerCase() === `http://${host}` || new URL(o).port === m[2]);
  if (!hostOk) return `host not allowed: ${host}`;
  if (!MUTATING.has(req.method.toUpperCase())) return null;
  const origin = req.headers.get("origin");
  if (origin !== null) return origins.has(origin.replace(/\/+$/, "")) ? null : `origin not allowed: ${origin}`;
  const ct = req.headers.get("content-type");
  const hasBody = Number(req.headers.get("content-length") ?? 0) > 0 || req.headers.has("transfer-encoding") || ct !== null;
  if (hasBody && !isJson(ct)) return "mutating requests with a body must be application/json";
  return null;
}

function withNosniff(res: Response): Response {
  try {
    res.headers.set("x-content-type-options", "nosniff");
    return res;
  } catch {
    const headers = new Headers(res.headers);
    headers.set("x-content-type-options", "nosniff");
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }
}

export function guard<A extends unknown[]>(fetchFn: (req: Request, ...rest: A) => Response | Promise<Response>, opts: GuardOptions): (req: Request, ...rest: A) => Promise<Response> {
  const origins = allowedOrigins(opts.port, opts.env);
  return async (req, ...rest) => {
    const why = checkRequest(req, origins);
    if (why) return withNosniff(new Response(JSON.stringify({ error: `forbidden: ${why}` }), { status: 403, headers: { "content-type": "application/json" } }));
    return withNosniff(await fetchFn(req, ...rest));
  };
}
