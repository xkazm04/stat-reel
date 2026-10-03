import { describe, expect, it } from "vitest";
import { guard } from "./http-guard";

const ok = async () => new Response("ok");
const g = guard(ok, { port: 8787, env: {} });
const req = (path: string, init: RequestInit & { host?: string } = {}) => {
  const { host = "127.0.0.1:8787", ...rest } = init;
  return new Request(`http://${host}${path}`, { ...rest, headers: { host, ...(rest.headers as Record<string, string>) } });
};

describe("http guard", () => {
  it("rejects a foreign Host (DNS rebinding)", async () => {
    expect((await g(req("/api/projects", { host: "evil.example:8787" }))).status).toBe(403);
    expect((await g(req("/api/projects", { host: "127.0.0.1:9999" }))).status).toBe(403);
  });
  it("rejects a cross-origin text/plain POST", async () => {
    const r = await g(req("/mcp", { method: "POST", body: "{}", headers: { origin: "https://evil.example", "content-type": "text/plain" } }));
    expect(r.status).toBe(403);
  });
  it("rejects a no-Origin simple-content-type POST", async () => {
    expect((await g(req("/mcp", { method: "POST", body: "{}", headers: { "content-type": "text/plain" } }))).status).toBe(403);
  });
  it("passes a studio-origin JSON POST (both loopback spellings)", async () => {
    for (const origin of ["http://127.0.0.1:5173", "http://localhost:5173", "http://127.0.0.1:8787"]) {
      const r = await g(req("/api/projects", { method: "POST", body: "{}", headers: { origin, "content-type": "application/json" } }));
      expect(r.status).toBe(200);
    }
  });
  it("passes a no-Origin JSON POST (claude CLI, worker callbacks) and a bodiless POST", async () => {
    expect((await g(req("/mcp", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }))).status).toBe(200);
    expect((await g(req("/api/jobs/x/cancel", { method: "POST" }))).status).toBe(200);
  });
  it("passes a proxied studio request (Host = studio port)", async () => {
    expect((await g(req("/api/health", { host: "127.0.0.1:5173" }))).status).toBe(200);
  });
  it("leaves GET /files alone and adds nosniff everywhere", async () => {
    const r = await g(req("/files/a.mp4"));
    expect(r.status).toBe(200);
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await g(req("/x", { host: "evil.example:1" }))).headers.get("x-content-type-options")).toBe("nosniff");
  });
  it("honours E2E_STUDIO_PORT and STATREEL_ALLOWED_ORIGINS", async () => {
    const g2 = guard(ok, { port: 8797, env: { E2E_STUDIO_PORT: "5183", STATREEL_ALLOWED_ORIGINS: "http://127.0.0.1:3000" } });
    for (const origin of ["http://127.0.0.1:5183", "http://127.0.0.1:3000"]) {
      expect((await g2(req("/api/x", { host: "127.0.0.1:8797", method: "POST", body: "{}", headers: { origin, "content-type": "application/json" } }))).status).toBe(200);
    }
    expect((await g2(req("/api/x", { host: "127.0.0.1:8797", method: "POST", body: "{}", headers: { origin: "http://127.0.0.1:5173", "content-type": "application/json" } }))).status).toBe(403);
  });
});
