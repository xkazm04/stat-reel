# 008 - Board libraries (Styles, Use cases), a text-only case loop, and generated images

- Status: accepted
- Date: 2026-10-01
- Extends: ADR 006 (Board) and ADR 007 (time-evolution format).

## Context

107 designs from the grok mass run (gk-001..006) went to the owner, who made 40 decisions:
- 9 accepted;
- 25 rejected on both axes, 5 on style, 1 on case.

**Every new F1 case a seat proposed was rejected.** Examples are podium width, the scoring window,
the strike rate and the gap to second. All the accepts were on the long registry cases. The owner:

> "it seems we are locked in our own data, are not able to generate much of valuable use cases,
> leading into repetetive style creativity. [...] Use cases approved we always need a long enough
> timeline (decade, all time) [...] declined types of use cases often cannot last or do not provide
> any interesting insight, artstyle is often locked in same x chart approaches - we may want to work
> more also with images as grok cli can generate ones".

Judging style and case together on a single design hid which axis failed. A seat that has to make a
design also spends its effort on visuals, not on finding a story.

## Decision

1. **The Board gets two libraries.**
   - **Styles** is a gallery of every style with its verdict from the gate. The owner can **lock**
     it (a signature that loops rebuild faithfully), **retire** it (no longer built on), add a note
     and pick a hero design. Served by `GET/PATCH /api/styles`; the ledger sync carries it into
     the brief.
   - **Use cases** lists the registry formats, cases accepted through designs, and **case ideas**.
2. **A text-only case loop** (`board.mjs cases`, `/api/cases`). Seats propose use cases without
   any art style, one domain per seat: sports beyond F1, games, geo-economy, music, culture and
   science, and motorsport depth plus wildcards. Every idea must have:
   - **at least 10 years** of data time;
   - **at least 4 dated beats**;
   - a **tension** (expectation vs reality, graded by how checkable it is);
   - **unknowns** (what the data cannot claim);
   - **web-verified sources** with licence, class and confidence, and a data status: `staged`,
     `registry`, or `new-source`.

   The owner decides with typed reasons: accept, too short, no insight, no data, duplicate. Those
   reasons feed the next case loop (registry: content-research-grounding, review-iteration-loops).
3. **New data domains go through the registry.** A `new-source` idea never triggers ingestion.
   The owner approves a source, it is added to `data/registry/sources.yaml` with a verdict, and
   only then do `statreel_ingest` clients fetch it (CLAUDE.md).
4. **Generated images supplement the art, never the data** (registry: evidence-bound-visuals,
   image-prompt-composition, visual-style-locking).
   - Design seats may use grok's `image_gen` for textures, backdrops, scenes, motifs and fills.
   - Code still draws every checkable mark.
   - Every image is listed in `shot.json` with its exact prompt and role, carries the text ban, is
     illustrated (never photo-real), never puts a figure in a slot naming a real person, and stays
     under 2.5 MB (15 MB per design). `check.mjs` enforces the listing, size and text-ban prompt.
   - The text ban inside the pixels is not machine-checked yet (no OCR). Seats must look at their
     images, and the owner sees the result.
5. **Chart-form diversity.** The brief names chart forms that already appear five or more times on
   the Board and asks seats to stop reusing them unless reinvented. Accepted styles may record a
   `style.spec` (technique, palette with roles, type, finish, avoid list), which is what lets a
   locked style be rebuilt.

## Consequences

- The owner judges stories and looks separately. Design loops build on accepted cases and on
  locked or accepted styles.
- Deviation from visual-style-locking: here **lock** is an owner action, not the computed
  draft → proofing → locked ratchet, and a locked style has no approved reference sheet yet. Revisit
  when locked styles are rebuilt across many cases.
- Data expansion needs the owner's approval per source before any ingestion. The case loop produces
  the candidates.
