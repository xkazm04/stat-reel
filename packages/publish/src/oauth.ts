/**
 * Google OAuth 2.0 for installed (desktop) apps: loopback redirect on 127.0.0.1 + PKCE (S256).
 * Docs: https://developers.google.com/identity/protocols/oauth2/native-app (see API-NOTES.md).
 *
 * Tokens are persisted through an injected SecretStore (the app wires it to the OS keychain).
 * Nothing here runs at import time; `authorize()` is the only method that opens a browser.
 */
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export interface TokenProvider {
  getAccessToken(): Promise<string>;
}

export interface SecretStore {
  get(key: string): Promise<string | null | undefined>;
  set(key: string, value: string): Promise<void>;
}

export const GOOGLE_AUTH_URI = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token";

export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.force-ssl",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
] as const;

/** Where StatReel expects the downloaded desktop-client JSON (gitignored via `.statreel/`). */
export const DEFAULT_CLIENT_JSON = ".statreel/google-oauth-client.json";
export const DEFAULT_TOKEN_KEY = "google-oauth-token:youtube";

export interface OAuthClientConfig {
  client_id: string;
  /** Google issues a secret for desktop clients; it is not confidential but is still sent. */
  client_secret?: string;
  auth_uri?: string;
  token_uri?: string;
}

export interface StoredToken {
  access_token: string;
  /** epoch ms */
  expires_at: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
}

export class OAuthError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "OAuthError";
  }
}

/** Parse the JSON downloaded from Google Cloud Console (`{"installed": {...}}`). */
export function parseClientJson(json: string): OAuthClientConfig {
  const raw = JSON.parse(json) as { installed?: OAuthClientConfig; web?: unknown };
  if (!raw.installed) {
    throw new OAuthError("client JSON has no 'installed' section: create an OAuth client of type 'Desktop app'");
  }
  if (!raw.installed.client_id) throw new OAuthError("client JSON has no client_id");
  return raw.installed;
}

export async function loadClientConfig(path = DEFAULT_CLIENT_JSON): Promise<OAuthClientConfig> {
  return parseClientJson(await readFile(path, "utf8"));
}

const b64url = (buf: Buffer) => buf.toString("base64url");

/** RFC 7636: verifier = 43-128 unreserved chars; challenge = BASE64URL(SHA256(verifier)). */
export function pkceChallenge(verifier: string): string {
  return b64url(createHash("sha256").update(verifier, "ascii").digest());
}

export function createPkce(random: (n: number) => Buffer = randomBytes) {
  const verifier = b64url(random(32)); // 43 chars
  return { verifier, challenge: pkceChallenge(verifier), method: "S256" as const };
}

export interface LoopbackOAuthOptions {
  client: OAuthClientConfig;
  store: SecretStore;
  scopes?: readonly string[];
  storeKey?: string;
  fetch?: typeof fetch;
  /** opens the consent URL (e.g. via the OS browser); required for authorize() */
  openBrowser?: (url: string) => void | Promise<void>;
  /** loopback port; 0 = any free port (default) */
  port?: number;
  /** allow getAccessToken() to fall back to the interactive browser flow (default false) */
  interactive?: boolean;
  now?: () => number;
  random?: (n: number) => Buffer;
  /** authorize() gives up after this long (default 5 min) */
  authorizeTimeoutMs?: number;
}

export class LoopbackOAuth implements TokenProvider {
  private readonly scopes: readonly string[];
  private readonly storeKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly random: (n: number) => Buffer;
  private cached: StoredToken | null = null;

  constructor(private readonly opts: LoopbackOAuthOptions) {
    this.scopes = opts.scopes ?? YOUTUBE_SCOPES;
    this.storeKey = opts.storeKey ?? DEFAULT_TOKEN_KEY;
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.now = opts.now ?? Date.now;
    this.random = opts.random ?? randomBytes;
  }

  get tokenUri() {
    return this.opts.client.token_uri ?? GOOGLE_TOKEN_URI;
  }

  buildAuthUrl(p: { redirectUri: string; state: string; codeChallenge: string; loginHint?: string }): string {
    const url = new URL(this.opts.client.auth_uri ?? GOOGLE_AUTH_URI);
    url.searchParams.set("client_id", this.opts.client.client_id);
    url.searchParams.set("redirect_uri", p.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", this.scopes.join(" "));
    url.searchParams.set("code_challenge", p.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", p.state);
    if (p.loginHint) url.searchParams.set("login_hint", p.loginHint);
    return url.toString();
  }

  async getAccessToken(): Promise<string> {
    const token = this.cached ?? (await this.load());
    if (token && token.expires_at - 60_000 > this.now()) return token.access_token;
    if (token?.refresh_token) return (await this.refresh(token.refresh_token)).access_token;
    if (this.opts.interactive) return (await this.authorize()).access_token;
    throw new OAuthError("no Google token: run the YouTube 'connect' step (see packages/publish/SETUP.md)", "no_token");
  }

  /** POST grant_type=refresh_token. Keeps the old refresh token when Google omits a new one. */
  async refresh(refreshToken: string): Promise<StoredToken> {
    const body = new URLSearchParams({
      client_id: this.opts.client.client_id,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    if (this.opts.client.client_secret) body.set("client_secret", this.opts.client.client_secret);
    const token = await this.tokenRequest(body);
    return this.save({ ...token, refresh_token: token.refresh_token ?? refreshToken });
  }

  /** POST grant_type=authorization_code with the PKCE verifier. */
  async exchangeCode(code: string, redirectUri: string, codeVerifier: string): Promise<StoredToken> {
    const body = new URLSearchParams({
      client_id: this.opts.client.client_id,
      code,
      code_verifier: codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    });
    if (this.opts.client.client_secret) body.set("client_secret", this.opts.client.client_secret);
    return this.save(await this.tokenRequest(body));
  }

  /** Interactive consent: listen on 127.0.0.1, open the browser, wait for ?code=&state=. */
  async authorize(loginHint?: string): Promise<StoredToken> {
    const open = this.opts.openBrowser;
    if (!open) throw new OAuthError("authorize() needs an openBrowser callback");
    const pkce = createPkce(this.random);
    const state = b64url(this.random(16));
    const server = createServer();
    await new Promise<void>((res, rej) => {
      server.once("error", rej);
      server.listen(this.opts.port ?? 0, "127.0.0.1", () => res());
    });
    const { port } = server.address() as AddressInfo;
    const redirectUri = `http://127.0.0.1:${port}`;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const code = await new Promise<string>((res, rej) => {
        timer = setTimeout(
          () => rej(new OAuthError("authorization timed out", "timeout")),
          this.opts.authorizeTimeoutMs ?? 300_000,
        );
        server.on("request", (req, resp) => {
          const url = new URL(req.url ?? "/", redirectUri);
          const error = url.searchParams.get("error");
          const got = url.searchParams.get("code");
          if (!error && !got) {
            resp.writeHead(404).end();
            return;
          }
          const ok = !error && url.searchParams.get("state") === state;
          resp.writeHead(ok ? 200 : 400, { "Content-Type": "text/plain; charset=utf-8" });
          resp.end(
            ok
              ? "StatReel is connected to YouTube. You can close this tab."
              : "Authorization failed. Return to StatReel.",
          );
          if (error) rej(new OAuthError(`authorization denied: ${error}`, error));
          else if (!ok || !got) rej(new OAuthError("state mismatch in OAuth callback", "state_mismatch"));
          else res(got);
        });
        Promise.resolve(
          open(this.buildAuthUrl({ redirectUri, state, codeChallenge: pkce.challenge, loginHint })),
        ).catch(rej);
      });
      return await this.exchangeCode(code, redirectUri, pkce.verifier);
    } finally {
      // every way out (callback, denial, timeout, a browser that would not open) drops the timer
      clearTimeout(timer);
      server.close();
    }
  }

  private async tokenRequest(body: URLSearchParams): Promise<StoredToken> {
    const res = await this.fetchImpl(this.tokenUri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || typeof json.access_token !== "string") {
      const code = typeof json.error === "string" ? json.error : `http_${res.status}`;
      const hint =
        code === "invalid_grant"
          ? " (refresh token revoked or expired - apps in 'Testing' status get 7-day refresh tokens; reconnect)"
          : "";
      throw new OAuthError(`token request failed: ${code}${hint}`, code);
    }
    return {
      access_token: json.access_token,
      expires_at: this.now() + Number(json.expires_in ?? 3600) * 1000,
      refresh_token: typeof json.refresh_token === "string" ? json.refresh_token : undefined,
      scope: typeof json.scope === "string" ? json.scope : undefined,
      token_type: typeof json.token_type === "string" ? json.token_type : undefined,
    };
  }

  private async load(): Promise<StoredToken | null> {
    const raw = await this.opts.store.get(this.storeKey);
    if (!raw) return null;
    try {
      this.cached = JSON.parse(raw) as StoredToken;
    } catch {
      this.cached = null;
    }
    return this.cached;
  }

  private async save(token: StoredToken): Promise<StoredToken> {
    const clean = Object.fromEntries(
      Object.entries(token).filter(([, v]) => v !== undefined),
    ) as unknown as StoredToken;
    this.cached = clean;
    await this.opts.store.set(this.storeKey, JSON.stringify(clean));
    return clean;
  }
}
