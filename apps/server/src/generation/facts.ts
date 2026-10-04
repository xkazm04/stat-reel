/**
 * The data gate of a generated video (DESIGN data gate, ADR 010): `data_provenance: "real"` is not accepted on
 * the model's word. Every fact ref of the props is resolved against the warehouse and every figure the video
 * shows must equal the fact it cites, the same way `ProjectService.setProps` checks co-pilot props
 * (`wh.facts` + `matchesDisplayed`; the rounding and sign rules live in projects.ts and are reused, not forked).
 * Pure given the resolver: no warehouse import here.
 */
import { DataRacePropsSchema, isSampleRef } from "@statreel/schemas";
import { matchesDisplayed, parseDisplayed } from "../projects";

/** `wh.facts`: `<row fact_key>#<column>` -> value, absent when the ref does not resolve. */
export type FactResolver = (refs: string[]) => Promise<Map<string, number | string>>;

/** A figure in a text: optional sign (U+2212 / dashes normalised), digits with optional thousands commas and decimals. */
const FIGURE = /[+\-−–‒]?\d[\d,]*(?:\.\d+)?/g;
/** An integer year is a label, not a measured figure (the date of a row is part of its fact_key). */
const isYear = (token: string) => /^\d{4}$/.test(token) && Number(token) >= 1800 && Number(token) <= 2100;

/**
 * Problems of one displayed text against the fact it cites. Every figure of the text must match the fact
 * (rounded, sign-exact); a text without a figure shows nothing to check. A string fact can only be compared
 * for digits: each figure of the text must occur in it.
 */
export function textFigureProblems(who: string, text: string, ref: string, fact: number | string): string[] {
  const problems: string[] = [];
  for (const token of text.match(FIGURE) ?? []) {
    if (isYear(token)) continue;
    const shown = parseDisplayed(token);
    const ok =
      typeof fact === "number" || /^-?\d+(\.\d+)?$/.test(String(fact))
        ? matchesDisplayed(Number(fact), shown, text)
        : String(fact).includes(token.replace(/,/g, ""));
    if (!ok) problems.push(`${who}: '${token}' in "${text}" != fact ${ref} = ${String(fact)}`);
  }
  return problems;
}

/**
 * Every ref of a "real" generate_video props file, with the checks that need the warehouse.
 * Returns human-readable problems (empty = verified). Props that do not parse are the validator's concern
 * and return no problems here.
 */
export async function verifyRealFacts(props: unknown, resolve: FactResolver): Promise<string[]> {
  const parsed = DataRacePropsSchema.safeParse(props);
  if (!parsed.success) return [];
  const p = parsed.data;
  const refs = [
    ...p.entities.map((e) => e.value_ref),
    ...p.events.flatMap((ev) => ev.facts.map((f) => f.ref)),
    ...p.spotlight.facts.map((f) => f.ref),
  ];
  const problems: string[] = [];
  const real = refs.filter((r) => !isSampleRef(r));
  for (const r of new Set(refs.filter(isSampleRef)))
    problems.push(`${r}: the sample: namespace is invented data and is refused under data_provenance "real"`);
  const facts = real.length ? await resolve([...new Set(real)]) : new Map<string, number | string>();
  const need = (who: string, ref: string): number | string | undefined => {
    if (isSampleRef(ref)) return undefined;
    const v = facts.get(ref);
    if (v === undefined) problems.push(`${who}: unknown fact ${ref} (it does not resolve against the warehouse)`);
    return v;
  };
  for (const e of p.entities) {
    const v = need(`entity ${e.id}`, e.value_ref);
    if (v === undefined) continue;
    if (!e.values.some((x) => x !== null && Math.abs(x - Number(v)) <= 1e-6))
      problems.push(`entity ${e.id}: fact ${e.value_ref} = ${String(v)} does not appear in its values series`);
  }
  for (const ev of p.events)
    for (const f of ev.facts) {
      const v = need(`event ${ev.id}`, f.ref);
      if (v !== undefined) problems.push(...textFigureProblems(`event ${ev.id}`, f.text, f.ref, v));
    }
  for (const f of p.spotlight.facts) {
    const v = need(`spotlight '${f.label}'`, f.ref);
    if (v !== undefined) problems.push(...textFigureProblems(`spotlight '${f.label}'`, f.value_text, f.ref, v));
  }
  return problems;
}
