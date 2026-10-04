import assert from "node:assert/strict";
import { test } from "node:test";
import { blockNetwork } from "../scripts/check-design.mjs";

test("blockNetwork aborts every http(s) request a seat page makes and reports it; file:// loads pass", async () => {
  const routes = [];
  const reported = [];
  await blockNetwork({ route: async (match, handler) => routes.push({ match, handler }) }, (u) => reported.push(u));
  assert.equal(routes.length, 1);
  const { match, handler } = routes[0];
  for (const u of ["https://cdn.jsdelivr.net/npm/d3", "http://127.0.0.1:8787/api/board", "HTTPS://fonts.example/x.woff2"]) assert.ok(match.test(u), u);
  for (const u of ["file:///C:/ws/data/f1_race_results.js", "data:image/png;base64,AAAA"]) assert.ok(!match.test(u), u);
  const aborted = [];
  await handler({ request: () => ({ url: () => "https://cdn.example/lib.js" }), abort: async (code) => aborted.push(code) });
  assert.deepEqual(aborted, ["blockedbyclient"]);
  assert.deepEqual(reported, ["https://cdn.example/lib.js"]);
});
