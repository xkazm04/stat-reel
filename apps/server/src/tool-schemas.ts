/**
 * One zod shape per StatReel tool (DESIGN §6.6), shared by the MCP server (live sessions: advertised
 * as the tool's JSON Schema and enforced by the SDK) and by the replay executor (which runs the same
 * schemas before the handler), so a replayed call is accepted or rejected exactly as a live one.
 * No React, no DOM.
 */
import { z } from "zod";

export const MAX_FRAMES = 6;

export const publishTarget = z.object({
  platform: z.enum(["youtube", "tiktok", "instagram"]),
  monetized: z.boolean(),
  ai_disclosure: z.boolean(),
  visibility: z.enum(["private", "unlisted", "draft"]).default("private"),
});

const project = z.string().min(1);

export const toolShapes = {
  list_use_cases: {},
  describe_views: { sport: z.string().optional() },
  query: { sql: z.string().min(1) },
  get_props_schema: { use_case: z.string().min(1) },
  set_props: { project, props: z.any() },
  write_script: { project, script: z.any() },
  generate_audio: { project, kind: z.enum(["tts", "music", "all"]).optional() },
  render_keyframes: {
    project,
    frames_s: z.array(z.number().min(0)).min(1, "give at least one second to render").max(MAX_FRAMES, `at most ${MAX_FRAMES} frames per call: ask for fewer seconds, or call again for the rest`),
  },
  get_render_report: { project },
  policy_check: { project, target: publishTarget },
} as const;

export type ToolShapeName = keyof typeof toolShapes;
const objects = Object.fromEntries(Object.entries(toolShapes).map(([k, v]) => [k, z.object(v)])) as { [K in ToolShapeName]: z.ZodObject<(typeof toolShapes)[K]> };

/** Validate (and default) a tool's input; the error text names every bad field so the model can fix it. */
export function parseToolInput(tool: string, input: unknown): { ok: true; value: Record<string, unknown> } | { ok: false; error: string; issues: { path: string; message: string }[] } {
  const schema = (objects as Record<string, z.ZodTypeAny>)[tool];
  if (!schema) return { ok: false, error: `unknown tool ${tool}`, issues: [] };
  const r = schema.safeParse(input ?? {});
  if (r.success) return { ok: true, value: r.data as Record<string, unknown> };
  const issues = r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
  return { ok: false, error: `invalid input for ${tool}: ${issues.map((i) => `${i.path || "(input)"}: ${i.message}`).join("; ")}`, issues };
}
