/**
 * The standard first prompt for a project: deterministic text, so replay fixtures key on it
 * (fixtureKey hashes it). Lives beside the key logic so a drift test can recompute the key.
 */
export type DraftProject = { id: string; title: string; sport: string; use_case_id: string; format: string; mode: string };

export function draftPrompt(p: DraftProject): string {
  return [
    `Project ${p.id}: "${p.title}".`,
    `Use case ${p.use_case_id}, sport ${p.sport}, format ${p.format}, mode ${p.mode}.`,
    "Draft the props and the script for this video now, following your workflow. Use project id",
    `"${p.id}" in set_props and write_script. Finish with one sentence naming the angle.`,
  ].join(" ");
}
