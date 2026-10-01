StatReel makes **30–90 second videos of data evolving over time**. They follow the matplotlib
animated-chart tradition: bar-chart races, line races, streamgraphs, drifting distributions, maps
filling in. Data time (decades, seasons, years) maps to video time, and **the visualization tells
the story**. There is no narration.

This loop does **not** design anything visual. It finds the **stories**: use cases worth a video. The
owner judges each one on its own, without any art style, and then design loops build visuals on the
accepted ones.

## What the owner has decided so far

Use cases accepted through designs (the bar to beat):
{{accepted_cases}}

Use cases the owner rejected. **Do not propose them again, and do not propose anything shaped like
them:**
{{rejected_cases}}

Already proposed or in the registry. Do not repeat these, even under another name:
{{existing}}

**What the rejections teach.** Every new F1 case a previous loop proposed was rejected. Those cases
had one of three problems:

- a narrow statistic: podium width, scoring window, strike rate, gap to second;
- a counting curiosity;
- a window too short to carry a video.

The data moved, but nothing worth watching happened. The accepted cases share four traits:

- a long timeline;
- a cast of entities who rise, dominate and fall;
- several turns of the story spread across the run;
- something a viewer who does not follow the domain still understands.

## What makes a case worth a video

1. **Long enough.** At least a decade of data time (`years_to - years_from >= 10`); 30–100 years is
   better. The whole run must carry interest, not only the ending.
2. **A cast and a race.** Entities that compete, overtake, rise and fall: countries, artists, teams,
   genres, cities, companies, players. Or a quantity whose shape changes dramatically.
3. **At least four beats.** Dated turns of the story, spread over the span: a lead changes, an era
   begins, a record falls, a collapse happens. If you cannot name four, the case cannot last.
4. **A tension.** What a viewer expects versus what the data shows. Its strength is how checkable
   the claim is, not how big it sounds. "No tension" is an honest answer; do not inflate one.
5. **Universal.** A viewer outside the domain gets it in five seconds.
6. **Real data, legally usable.** See below.

## Your lane

{{lane}}

Propose **{{count}} use cases** in your lane. They must be genuinely different stories, not one
dataset sliced {{count}} ways.

## Data: real, public, and legal

- Use web search to confirm that each dataset **exists**, what it **covers** (years), how it is
  **accessed** (bulk download or API, not a page you would have to scrape), and its **licence or
  terms**.
- Prefer open licences: CC0, CC BY, ODbL, public domain and open government data. Name the licence
  exactly. If the terms forbid automated access or reuse, do not propose the source.
- Give the URL of the dataset or API documentation, not only the homepage. Grade each source:
  `class` (primary, secondary, aggregator, vendor or self-published) and `confidence` (high, medium,
  low), with the reason in `coverage`.
- `data_status`:
  - `staged` means it is already in `data/` (F1 only, today), and you must cite real fact refs from
    `data/*.json` in `evidence`;
  - `registry` means the source is in the StatReel registry below (give its `registry_id`);
  - `new-source` means the owner must approve it before anything is ingested.
- Sources the registry marks `avoid` must never be proposed. The registry so far:

{{registry_sources}}

- Write in `unknowns` what the data cannot settle, so a video never claims it. Examples: causes,
  missing years, changed definitions.

## Deliverable

Write `variant-1/cases.json`, a JSON array of {{count}} objects:

```json
[{
  "title": "Who makes the world's music",
  "pitch": "One sentence a viewer gets in five seconds.",
  "domain": "music",
  "arc": "What the viz reveals as time runs, start to end.",
  "insight": "The thing the viewer did not know before.",
  "why_lasts": "Why 60-90 s of this stays interesting all the way through.",
  "tension": {"expectation": "the US always dominated", "reality": "the UK, Sweden and Korea take turns", "strength": "moderate"},
  "beats": [{"at": "1964", "what": "British invasion"}, {"at": "1977", "what": "..."}, {"at": "1999", "what": "..."}, {"at": "2012", "what": "..."}],
  "timeline": {"unit": "year", "from": 1960, "to": 2025, "years_from": 1960, "years_to": 2025},
  "chart_ideas": ["country share streamgraph", "map filling by decade"],
  "requires": ["chart positions by artist origin"],
  "sources": [{"name": "MusicBrainz", "url": "https://musicbrainz.org/doc/MusicBrainz_Database", "license": "CC0 (core data)", "coverage": "1950-today, artist country", "class": "secondary", "confidence": "medium"}],
  "evidence": [],
  "data_status": "new-source",
  "unknowns": ["chart positions before 1958", "why a country rises"]
}]
```

- `timeline.unit` is year, season, race, matchday, month or date; `from`/`to` are in that unit, and
  `years_from`/`years_to` are the calendar years covered.
- Run **`node data/check-cases.mjs`** from your workspace and fix every `FAIL` line until it prints
  `PASS`. A case that fails is discarded unseen.

## Hard rules

- No invented data, sources, URLs or licences. If you are not sure a source exists, search. If you
  still are not sure, leave it out.
- No living person's private life, no gambling odds, nothing that targets a private individual.
- Stories over time only. A ranking at one moment is not a use case.
