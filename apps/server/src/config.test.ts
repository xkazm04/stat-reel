import { describe, expect, it } from "vitest";
import { parseEnv } from "./config";

describe("parseEnv", () => {
  it("keeps the defaults: llm and audio live, publish dry", () => {
    const e = parseEnv({});
    expect([e.LLM_MODE, e.AUDIO_MODE, e.PUBLISH_MODE]).toEqual(["live", "live", "dry"]);
    expect(e.STATREEL_PORT).toBeUndefined();
  });

  it("accepts the e2e and live-e2e env", () => {
    expect(
      parseEnv({
        LLM_MODE: "replay",
        AUDIO_MODE: "replay",
        PUBLISH_MODE: "dry",
        GEN_MODE: "fake",
        STATREEL_PORT: "8797",
        LLM_RECORD: "",
        AUDIO_RECORD: "",
        GEN_FAKE_DELAY_MS: "800",
      }),
    ).toMatchObject({ LLM_MODE: "replay", STATREEL_PORT: 8797 });
    expect(parseEnv({ LLM_MODE: "live", AUDIO_MODE: "live", PUBLISH_MODE: "dry" }).LLM_MODE).toBe("live");
  });

  it("a mode typo is an error naming the key and the allowed values, never live", () => {
    expect(() => parseEnv({ LLM_MODE: "reply" })).toThrow(/LLM_MODE must be one of live \| replay/);
    expect(() => parseEnv({ AUDIO_MODE: "Replay" })).toThrow(/AUDIO_MODE must be one of live \| replay/);
    expect(() => parseEnv({ PUBLISH_MODE: "public" })).toThrow(/PUBLISH_MODE must be one of live \| dry/);
  });

  it("an explicit empty mode is an error; an empty number is unset", () => {
    expect(() => parseEnv({ LLM_MODE: "" })).toThrow(/LLM_MODE/);
    expect(parseEnv({ STATREEL_PORT: "" }).STATREEL_PORT).toBeUndefined();
  });

  it("rejects NaN and out-of-range numbers, reporting every bad key in one error", () => {
    expect(() => parseEnv({ STATREEL_PORT: "abc" })).toThrow(/STATREEL_PORT/);
    expect(() => parseEnv({ STATREEL_PORT: "70000" })).toThrow(/<= 65535/);
    expect(() => parseEnv({ STATREEL_PORT: "80.5" })).toThrow(/integer/);
    expect(() => parseEnv({ STATREEL_JOB_RETENTION_DAYS: "0" })).toThrow(/STATREEL_JOB_RETENTION_DAYS/);
    expect(() => parseEnv({ LLM_MODE: "x", STATREEL_PORT: "y" })).toThrow(/LLM_MODE[\s\S]*STATREEL_PORT/);
  });
});
