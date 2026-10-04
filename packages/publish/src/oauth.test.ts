/** Unit tests for the loopback OAuth helper. fetch is always mocked; nothing opens a browser. */
import { get } from "node:http";
import { describe, expect, it, vi } from "vitest";
import {
  createPkce,
  LoopbackOAuth,
  OAuthError,
  parseClientJson,
  pkceChallenge,
  type SecretStore,
  YOUTUBE_SCOPES,
} from "./oauth";

const client = { client_id: "cid.apps.googleusercontent.com", client_secret: "csecret" };

function memoryStore(init: Record<string, string> = {}): SecretStore & { data: Record<string, string> } {
  const data = { ...init };
  return {
    data,
    get: async (k) => data[k],
    set: async (k, v) => {
      data[k] = v;
    },
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("PKCE", () => {
  it("matches the RFC 7636 appendix B test vector", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("creates a 43-char base64url verifier and S256 challenge", () => {
    const p = createPkce(() => Buffer.alloc(32, 7));
    expect(p.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(p.challenge).toBe(pkceChallenge(p.verifier));
    expect(p.method).toBe("S256");
  });
});

describe("LoopbackOAuth", () => {
  it("builds the Google consent URL for a loopback redirect", () => {
    const oauth = new LoopbackOAuth({ client, store: memoryStore() });
    const url = new URL(
      oauth.buildAuthUrl({ redirectUri: "http://127.0.0.1:53682", state: "st", codeChallenge: "ch" }),
    );
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: client.client_id,
      redirect_uri: "http://127.0.0.1:53682",
      response_type: "code",
      scope: YOUTUBE_SCOPES.join(" "),
      code_challenge: "ch",
      code_challenge_method: "S256",
      state: "st",
    });
    expect(url.searchParams.get("scope")).toContain("youtube.upload");
    expect(url.searchParams.get("scope")).toContain("youtube.force-ssl");
    expect(url.searchParams.get("scope")).toContain("yt-analytics.readonly");
  });

  it("refreshes an expired token with a form-encoded POST and persists it", async () => {
    const store = memoryStore({
      "google-oauth-token:youtube": JSON.stringify({ access_token: "old", expires_at: 1_000, refresh_token: "rt-1" }),
    });
    const fetchMock = vi.fn(async () =>
      jsonResponse({ access_token: "new", expires_in: 3599, token_type: "Bearer", scope: "s" }),
    );
    const oauth = new LoopbackOAuth({ client, store, fetch: fetchMock as unknown as typeof fetch, now: () => 10_000 });

    expect(await oauth.getAccessToken()).toBe("new");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
      client_id: client.client_id,
      client_secret: "csecret",
      grant_type: "refresh_token",
      refresh_token: "rt-1",
    });
    const saved = JSON.parse(store.data["google-oauth-token:youtube"] ?? "{}");
    expect(saved).toMatchObject({ access_token: "new", refresh_token: "rt-1", expires_at: 10_000 + 3_599_000 });

    // cached: no second request while valid
    expect(await oauth.getAccessToken()).toBe("new");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses a still-valid stored token without any request", async () => {
    const store = memoryStore({
      "google-oauth-token:youtube": JSON.stringify({ access_token: "ok", expires_at: 999_999 }),
    });
    const fetchMock = vi.fn();
    const oauth = new LoopbackOAuth({ client, store, fetch: fetchMock as unknown as typeof fetch, now: () => 0 });
    expect(await oauth.getAccessToken()).toBe("ok");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exchanges an auth code with the PKCE verifier", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ access_token: "a", refresh_token: "r", expires_in: 3600 }));
    const store = memoryStore();
    const oauth = new LoopbackOAuth({ client, store, fetch: fetchMock as unknown as typeof fetch, now: () => 0 });
    await oauth.exchangeCode("code-1", "http://127.0.0.1:5000", "verifier-1");
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
      client_id: client.client_id,
      client_secret: "csecret",
      code: "code-1",
      code_verifier: "verifier-1",
      grant_type: "authorization_code",
      redirect_uri: "http://127.0.0.1:5000",
    });
    expect(JSON.parse(store.data["google-oauth-token:youtube"] ?? "{}")).toMatchObject({
      access_token: "a",
      refresh_token: "r",
    });
  });

  it("surfaces invalid_grant with the 7-day Testing-status hint", async () => {
    const store = memoryStore({
      "google-oauth-token:youtube": JSON.stringify({ access_token: "x", expires_at: 0, refresh_token: "dead" }),
    });
    const fetchMock = vi.fn(async () => jsonResponse({ error: "invalid_grant" }, 400));
    const oauth = new LoopbackOAuth({ client, store, fetch: fetchMock as unknown as typeof fetch, now: () => 1 });
    await expect(oauth.getAccessToken()).rejects.toThrow(/invalid_grant.*7-day/);
  });

  it("does not fall back to a browser unless interactive", async () => {
    const oauth = new LoopbackOAuth({ client, store: memoryStore(), fetch: vi.fn() as unknown as typeof fetch });
    await expect(oauth.getAccessToken()).rejects.toBeInstanceOf(OAuthError);
  });

  it("parses a desktop client JSON and rejects a web client", () => {
    expect(parseClientJson(JSON.stringify({ installed: { client_id: "a", client_secret: "b" } }))).toEqual({
      client_id: "a",
      client_secret: "b",
    });
    expect(() => parseClientJson(JSON.stringify({ web: { client_id: "a" } }))).toThrow(/Desktop app/);
  });
});

/** Plays the browser: GET the loopback redirect with the given query, resolve the status code. */
function hitLoopback(authUrl: string, query: (state: string) => string): Promise<number> {
  const u = new URL(authUrl);
  const target = `${u.searchParams.get("redirect_uri")}/?${query(u.searchParams.get("state") ?? "")}`;
  return new Promise((resolve, reject) => {
    get(target, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    }).on("error", reject);
  });
}

describe("LoopbackOAuth.authorize (loopback on 127.0.0.1, fetch mocked)", () => {
  it("rejects a callback whose state is not the one it sent, without a token request", async () => {
    const fetchMock = vi.fn();
    let status: Promise<number> = Promise.resolve(0);
    const oauth = new LoopbackOAuth({
      client,
      store: memoryStore(),
      fetch: fetchMock as unknown as typeof fetch,
      openBrowser: (url) => {
        status = hitLoopback(url, () => "code=c1&state=forged");
      },
    });
    await expect(oauth.authorize()).rejects.toMatchObject({ code: "state_mismatch" });
    expect(await status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exchanges the code with the PKCE verifier and the loopback redirect it listened on", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ access_token: "a", refresh_token: "r", expires_in: 3600 }));
    let redirect = "";
    let status: Promise<number> = Promise.resolve(0);
    const oauth = new LoopbackOAuth({
      client,
      store: memoryStore(),
      fetch: fetchMock as unknown as typeof fetch,
      now: () => 0,
      random: (n) => Buffer.alloc(n, 3),
      openBrowser: (url) => {
        redirect = new URL(url).searchParams.get("redirect_uri") ?? "";
        status = hitLoopback(url, (state) => `code=c1&state=${state}`);
      },
    });
    await expect(oauth.authorize()).resolves.toMatchObject({ access_token: "a" });
    expect(await status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = Object.fromEntries(new URLSearchParams(String(init.body)));
    expect(redirect).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(body).toMatchObject({
      code: "c1",
      redirect_uri: redirect,
      code_verifier: createPkce(() => Buffer.alloc(32, 3)).verifier,
    });
  });

  it("leaves no pending timeout behind when the browser cannot be opened", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const oauth = new LoopbackOAuth({
        client,
        store: memoryStore(),
        openBrowser: () => {
          throw new Error("no browser on this machine");
        },
      });
      await expect(oauth.authorize()).rejects.toThrow(/no browser/);
      // a leftover 5-minute timer keeps a CLI `connect` process alive long after it reported the failure
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
