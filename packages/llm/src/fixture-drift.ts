/**
 * Fixture drift check: recompute the replay fixture key for the standard first prompt and say,
 * actionably, when an edit to a prompt has orphaned the committed fixture. The key hashes the
 * templated user prompt and the system prompt text (fixtureKey), so editing either re-keys the
 * fixture and `pnpm e2e` then fails far away with "LLM replay fixture missing".
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fixtureKey, templateOut } from "./index";

export type DriftInput = { fixturesDir: string; engine?: "claude-code" | "codex"; prompt: string; systemPrompt: string; vars: Record<string, string> };
export type FixtureMeta = { model?: string; turns?: number; cost_usd?: number };
export type DriftReport = { ok: boolean; key: string; file: string; meta?: FixtureMeta; message: string };

/** model id from the init line, turns and cost from the result line (all optional: cheap best effort). */
export function readFixtureMeta(file: string): FixtureMeta {
  const meta: FixtureMeta = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line.includes('"type":"system"') && !line.includes('"type":"result"')) continue;
    try {
      const m = JSON.parse(line);
      if (m.type === "system" && m.subtype === "init") meta.model = m.model;
      if (m.type === "result") {
        meta.turns = m.num_turns;
        meta.cost_usd = m.total_cost_usd;
      }
    } catch {
      /* a non-JSON line is not metadata */
    }
  }
  return meta;
}

export function checkFixtureDrift(i: DriftInput): DriftReport {
  const engine = i.engine ?? "claude-code";
  const key = fixtureKey(engine, templateOut(i.prompt, i.vars), undefined, i.systemPrompt);
  const file = path.join(i.fixturesDir, `${key}.jsonl`);
  if (existsSync(file)) {
    return { ok: true, key, file, meta: readFixtureMeta(file), message: `fixture ${key}.jsonl present` };
  }
  return {
    ok: false, key, file,
    message: [
      `The replay fixture for the standard first prompt is missing: expected ${file}.`,
      "A prompt edit (packages/llm/prompts/*.md or draftPrompt) re-keys it, so the committed fixture is orphaned and `pnpm e2e` would fail at the co-pilot step.",
      "Re-record it with a live run (spends Claude credits): LLM_RECORD=1 with LLM_MODE=live, which `pnpm e2e:live` sets, then commit the new e2e/fixtures/llm/*.jsonl and delete the orphan.",
      "Caution: `pnpm e2e:live` also sets AUDIO_MODE=live (ElevenLabs credits) and cross-env hard-codes it, so AUDIO_MODE=replay in your shell does NOT override it. To record only the LLM fixture run: npx cross-env LLM_MODE=live LLM_RECORD=1 AUDIO_MODE=replay PUBLISH_MODE=dry E2E_LIVE=1 playwright test - but a new script means new TTS text, which has no audio replay fixture, so expect to need the live audio run too.",
    ].join("\n"),
  };
}
