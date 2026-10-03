/**
 * The fact-reference grammar, shared by index.ts (`FactKey`) and data-race.ts (`DataRaceFactRef`).
 * index.ts re-exports data-race.ts, so data-race.ts cannot import index.ts back without a cycle; both
 * import this leaf instead, and the rule lives once.
 */
export const FACT_KEY_PATTERN = /^[a-z0-9-]+:[^#\s]+#[a-z_]+$/;
export const FACT_KEY_MESSAGE = "fact ref must be '<row fact_key>#<column>'";
