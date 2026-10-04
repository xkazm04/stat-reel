import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ApiError } from "../api";
import { Failure } from "./ui";

const HINT = "Is the API running";
const render = (error: unknown) => renderToStaticMarkup(createElement(Failure, { error, what: "The Board" }));

describe("Failure (copy names the cause it has)", () => {
  it("asks whether the API runs only when nothing answered", () => {
    // fetch itself threw: no server reached
    expect(render(new TypeError("Failed to fetch"))).toContain(HINT);
    // the dev proxy's own 500 while the API is down (text/plain, no {error} body)
    expect(render(new ApiError(500, null, "GET /api/board: 500 Internal Server Error"))).toContain(HINT);
    expect(render(new ApiError(502, "Bad Gateway", "GET /api/board: Bad Gateway"))).toContain(HINT);
  });
  it("an answer from the API is not a down API", () => {
    const answered = [
      new ApiError(409, { error: "a generation job is running for this item" }, "POST /api/x: busy"),
      new ApiError(500, { error: "SQLITE_BUSY: database is locked" }, "GET /api/board: SQLITE_BUSY"),
      new ApiError(404, { error: "no such project" }, "GET /api/projects/p: no such project"),
    ];
    for (const e of answered) {
      const html = render(e);
      expect(html).not.toContain(HINT);
      expect(html).toContain("did not load");
    }
  });
});
