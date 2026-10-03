# 011: Topic activity heatmap (topic × video ordinal, recency fill)

- **Status:** proposed (draft rev. 2, 2026-10-03; owner answered Q2)
- **Date:** 2026-10-03
- **Affects:** `apps/server` (`db.ts`: the `topics` and `videos` tables, plus `case_ideas.topic` and `projects.topic`; `topics.ts`; `pipeline.ts`; `GET /api/heatmap/topics`; `/api/topics`), `apps/studio` (`/heatmap` views, topic picker on the Use cases tab), `packages/schemas/src/topics.ts`, `.claude/skills/board/references/case-brief.md`, `DESIGN.md` §6.1 and §7.

## Context
- `/heatmap` shows feasibility: one use case per row and one sport per column.
- The owner wants a view of production activity instead: one topic per row, with column n being the n-th video created for that topic, coloured by how recent each video is.
- No table records finished videos as such.
- The owner defined a topic as a **broad domain**: a type of sport (Formula 1, football, boxing…) or a geo-economic discipline (energy, markets, demographics…). Free-text labels are out.

## Decision
1. **A controlled topic list:** a `topics(key, label, family, sort, active)` table, seeded idempotently from `TOPIC_SEED`. The seed comes from the existing case domains and registry sports: sports such as `formula-1` and `football`, geo-economic disciplines such as `energy` and `markets`, the broad families `culture`/`science`/`games`/`music`/`other`, and the reserved `unassigned`.
   - `case_ideas.topic` and `projects.topic` reference `topics.key` (an FK, also validated in the services; unknown keys get a 400).
   - Topics are retired, never deleted.
   - The case-loop brief must emit a seed key.
2. **A `videos` ledger table** gets one row per finished MP4, from pipeline renders and the `generate_video` finalize step, with an idempotent backfill from `renders`. `topic_key` references `topics(key)`, and the label is denormalised at insert.
3. **Topic resolution**, first match wins:
   1. `case_ideas.topic`;
   2. the unambiguous domain mapping (`f1` → `formula-1`, `music` → `music`, …; there's no default for `sports` or `geoeconomy`);
   3. `projects.topic`;
   4. `projects.sport` mapping (F1, NBA, NHL, Soccer);
   5. `unassigned`.
4. **`GET /api/heatmap/topics`** returns topics with ordered videos (`row_number()` per topic by `created_at`), the recency bucket of each video, pending jobs, and empty topics (from accepted cases, or all active topics on request).
5. **Recency buckets** (a shared constant):

   | Bucket | Age | Colour |
   |---|---|---|
   | fresh | ≤ 7 d | brand |
   | recent | ≤ 30 d | signal 55 % |
   | cooling | ≤ 90 d | signal 22 % |
   | cold | > 90 d | surface-2 |

   Every cell also prints its age as text.
6. **Views:** `/heatmap` defaults to `view=topics`. The feasibility grid stays as `view=feasibility`, and its layer-2 route is unchanged (the create-project flow depends on it).

## Consequences
- Rows are comparable, coarse domains, and the list grows only through an explicit owner action (`POST /api/topics`).
- The 46 existing `sports`/`geoeconomy` ideas need a topic picked by hand; until then they count as `unassigned`, and accepting a case asks for one.
- The owner's heatmap starts empty (0 renders today), so the empty states are first-class.
- Retitling a case or renaming a topic label doesn't move history.
