import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { denyHint } from "./deny-hints";

const rego = readFileSync(resolve(__dirname, "../../../../policy/publish.rego"), "utf8");

/** Every deny message of the policy: literal strings as written, sprintf templates with %s/%v/%q filled by sample words. */
function denyMessages(): string[] {
  const out = new Set<string>();
  // rule blocks start at column 0 with `deny contains` / `warn contains`; warnings carry no hint
  const blocks = rego.split(/\r?\n(?=deny |warn )/).filter((b) => b.startsWith("deny "));
  for (const block of blocks) {
    for (const m of block.matchAll(/deny contains "([^"]+)" if/g)) out.add(m[1] as string);
    for (const m of block.matchAll(/sprintf\("([^"]+)"/g))
      out.add((m[1] as string).replace("has no %s", "has no license_class").replace(/%[svq]/g, "sample"));
  }
  return [...out];
}

describe("denyHint", () => {
  it("knows every deny message of policy/publish.rego", () => {
    const msgs = denyMessages();
    expect(msgs.length).toBeGreaterThan(20);
    const unhinted = msgs.filter((m) => denyHint(m) === null);
    expect(unhinted).toEqual([]);
  });

  it("matches real reasons", () => {
    expect(denyHint("source fbref is non_commercial: not allowed on a monetized channel")).toMatch(/non-commercial/);
    expect(denyHint("duration outside the 30-90 s band")).toMatch(/30-90 s/);
    expect(denyHint("font fallbacks detected: 2")).toMatch(/fell back/);
    expect(denyHint("tts audio present but disclosure.ai_voice is not true")).toMatch(/disclosure/);
    expect(
      denyHint(
        "visibility public on youtube requires owner approval: v1 publishes private only (draft only where the platform has drafts)",
      ),
    ).toMatch(/private/);
  });

  it("gives no hint for an unknown reason", () => {
    expect(denyHint("the moon is in the wrong phase")).toBeNull();
    expect(denyHint("")).toBeNull();
  });
});
