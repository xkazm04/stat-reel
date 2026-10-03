import { describe, expect, it } from "vitest";
import { isModuleLoadError } from "./moduleError";

describe("isModuleLoadError", () => {
  it("recognises the chunk-load failures of each engine", () => {
    expect(isModuleLoadError(new TypeError("Failed to fetch dynamically imported module: http://x/assets/A-1.js"))).toBe(true);
    expect(isModuleLoadError(new TypeError("error loading dynamically imported module: http://x/a.js"))).toBe(true);
    expect(isModuleLoadError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isModuleLoadError(new Error("Unable to preload CSS for /assets/a.css"))).toBe(true);
  });
  it("leaves every other error alone", () => {
    expect(isModuleLoadError(new Error("boom"))).toBe(false);
    expect(isModuleLoadError(new Error("the Failed to fetch dynamically imported module"))).toBe(false);
    expect(isModuleLoadError({ message: "Failed to fetch dynamically imported module: x" })).toBe(true);
    expect(isModuleLoadError("Failed to fetch dynamically imported module")).toBe(false);
    expect(isModuleLoadError(null)).toBe(false);
    expect(isModuleLoadError(undefined)).toBe(false);
  });
});
