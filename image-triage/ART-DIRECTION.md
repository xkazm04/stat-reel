# StatReel art direction: the visual philosophy guide

- **Date:** 2026-10-03 (Europe/Prague). **Status:** draft, built from image-triage rounds 1–2, the boxing portrait experiment, and the search-box-wars video rounds v1–v3, and image-triage round 3 (concept/landing seats won all four cases).
- **Canonical home:** ai-registry, `knowledge/media-generation/visual-generation/data-video-art-direction/` (golden path, 14 techniques, 4 applications).
  This file is a readable copy for the studio. When the two differ, the registry wins.
- **Winners this guide is built on:** search-box-wars **v4**, africa-flags **v4**, f1-titles **v4**, most-played-fps **v5**, largest-empire **v4**.
  The round-1 winners were search v2, flags v3, f1 v1 and fps v1; the empire case needed a map/globe.
- **The owner's verdict in one line:** round 1 felt like "an infographic post". Dynamic HTML/CSS layers, a background matching the current
  leader's style, and photo evidence pop-ups fixed it. **A unique theme per case is the pattern that "gets the look above competition".**

## Quick rules (check every frame)
| Rule | Number |
|---|---|
| Motion cues per frame | **≤ 2**, each tied to a named beat (rolling digits count) |
| Evidence cards per frame | **1**, or one **stack** (a pile counts as one card; the entering card's transition is the frame's card cue) |
| Story text | **≥ 26 px** at 1080 wide; card sub-captions ≥ 22 px or cut |
| Source / credit lines | **none on screen** (owner, video 01 v1.2). Sources, method notes, tools ("Made with StatReel", Remotion) and photo/logo credits go in each video's **`DESCRIPTION.md`** (ready-to-paste YouTube description). CC BY / BY-SA (2.0–4.0) accept attribution in the description as "reasonable to the medium"; keep an on-card credit only when a specific licence or author requires it. Triage stills may keep a micro source line |
| No explainer legends | **graphics must be self-explanatory**: no small grey/green caption lines explaining the encoding ("weight = share", "order: 3-mo avg", "angle compressed", "zoom ±…") under charts, timelines or objects. Method notes go in the description. **Give the freed space to the entities** (logos ≥ 64 px, wordmarks ≥ 28 px, readable values). Only the required SPECULATIVE / SAMPLE tags stay (owner, video 01) |
| Safe box, vertical 1080×1920 | content in **y 150–1580**; keep the right icon column (x ≳ 960) mostly clear |
| Tilt | **≤ 15°** on anything carrying data, or tilt the background only |
| Evidence photos | **the same event**, or captioned as context ("March 2020: the world stays home") |
| Photos | credited in the **description** (title, author, link, licence, "cropped"); licence row logged before render; on-frame credit only if the licence demands it |
| Real people | **only real, freely licensed photos**, treated with deterministic filters; never generated; no photo → labelled placeholder |
| Identity colours | one per entity, never by category (no two leaders in the same blue) |
| Timing | **timing plan first**: change density → time warp, saved as JSON + note **before** render; order by 3-mo avg + hysteresis (documented in the description, not as an on-screen legend) |
| Event cards | own lifespan in **frames** (readable + ~2 s ≈ 4 s), date on the card, **stack** on overlap, creative enter/exit by card type |
| Rank chips | ≥ **1.5 s** in frames, independent of the warp |
| Titles | one plain topic line that fits one row (≈ 60 px); hook = a question; **never reveal the outcome** up front |
| Thumbnail | 1080×1920; the question + equal logo tiles of the key players (winner not first); no answer |
| Rows | **top 10** from real data with logos (Commons, licence + trademark logged; wordmark fallback) |
| Ending | winner spotlight (~2 s) → like & subscribe (~2 s) → Powered by StatReel, **Frame Stat** logo (~3 s) |
| Rotation / repeating patterns | **never spin a repeating pattern faster than ½ its period per frame** (36 spokes → < 5°/frame; aim ≤ 0.2 period), and never tie spin to a time-warped clock. **Prefer static objects with a sweeping light** (or non-periodic decals). **Measure aliasing before delivery** (per-frame angular step from the render: no negative steps, no stops, no spikes; `videos/02-tdf/wheel-lab/phase.py`). Render 60 fps when motion is continuous (video 02 lesson 22–23) |
| Yearly (coarse) data | interpolate between data points with a **monotone cubic** (passes through every value, no overshoot) and **disclose it in DESCRIPTION.md**. Freeze on the data's own time points, so card numbers equal on-screen numbers; never quote an interpolated month (video 03) |
| Object speed | cap with a **timing floor** (minimum frames per period = max Δvalue × px-per-unit / VMAX): **≤ ~2.5 px per 60-fps frame**. Check the last knot ≤ timelineEnd, or the clock jumps at the cut (video 03 lesson 24) |
| Flicker / ambient motion | a few incommensurate sines **≤ 1.2 Hz**, small amplitude, keyed to the output frame (not the warped clock); **measure** the brightness spectrum on the render (no energy peak above 3 Hz). Rolling digits must be **fully settled** whenever the value is static (video 03) |
| Positions (small fixed sets) | **≤ 10 objects without a rank-race concept → fixed slots for the whole video**, sorted descending by the **starting** value, never reordered, whatever the ending (owner, video 03 v2: reordering confused even with crossfades). Rank races (bar races, standings) may still reorder with hysteresis + a ≥ 0.6 s throttle + eased crossfades |
| Growth cues | **express growth through the object's own energy** (flame size/brightness, glow, heat) proportional to the smoothed on-screen rise rate, eased, capped, deterministic, measured (no energy above 3 Hz); falls may use their own cue (smoke). **No "target"/guide/ghost outlines** showing where an object will grow or has been (owner, video 03 v2) |
| Champion change | boxing **t2 split-wipe** (jagged diagonal seam, outgoing desaturated, palette flips) |
| Triage proposals | **4 per case**: **2 concept/landing** (one non-obvious metaphor, code-drawn per-item art, nested back/mid/front, zoom lens, headline claim) + **2 data-chart**. Either kind can win; see §7 |


## 1 · The philosophy (golden path)

A narration-free data video is judged in the first frame the viewer sees,
and on a phone. A correct chart on a plain dark ground with a tidy callout
reads as **an infographic post**: competent, interchangeable, and easy to
scroll past. What lifts the same data above the competition is not more
decoration. It is a frame that looks like **a moment from a broadcast about
this one story**. Its look comes from the story's own world, real evidence
pops up when the data reacts, and a small number of motion cues prove the
frame is part of a moving picture.

This subject is about **how the frame looks** once an idea has passed the
choosing stage (`data-video-virality`). What a chart may claim belongs to
`evidence-bound-visuals`, and aspect and safe-area adaptation per platform
belong to `platform-format-adaptation`. Both are cited here, not restated.

### The governing fact: every case gets its own world

The strongest single pattern in review is that **a unique theme per case beats
a house theme applied to every case**. A house frame (one ground, one accent,
one card style) is consistent but makes every video look like every other bar
race. A theme drawn from the story's world tells the viewer what they are
watching before they read a label. That world might be a search engine's
palette, a racing team's livery, the flag colours of the year's biggest new
state, a steppe at dusk, smoke and embers for a shooter, or a 1980s fight
poster. The house identity survives in the invariants: the clock position,
the progress bar, the type families, the source line and the safe zones.
The world changes per case.

Three moves did most of the lifting from "infographic" to "broadcast":

1. **A background that follows the current leader** (leader-adaptive-theme).
   The far plane takes the colours or photo world of whoever leads now, and
   it cross-fades when the lead changes, so the lead change becomes the
   motion moment.
2. **Real evidence that pops up** (evidence-card-popup). A dated photo, a
   screenshot, a manuscript or a clipping on a card makes the event beat feel
   like news, not an annotation.
3. **Motion cues, capped** (motion-cue-budget). Digits caught mid-roll, sparks
   at an overtake, a smear behind a newcomer: two at most per frame.

### Principles

- **The chart form follows the story, not the template**
  (case-native-chart-form). Draw a crossing as a line race, collected titles
  as year blocks, territory as a globe, a wave of independence as a flag map
  with a dated log. A form that hides the story's move is wrong however
  pretty it is.
- **The event is shown on the data**: a leader line, a glow on the bar that
  changed, a pulse on the territory, an overtake arrow. The card adds the
  evidence; the data shows the effect.
- **Legibility is a floor, not a goal** (legibility-floor). Story text at
  26 px or more at 1080 wide. Content stays inside the platform's safe box.
  Tilt is 15° or less on anything carrying data, or tilt the background only.
- **One authority per frame.** One hero (the data), one evidence card, one
  title. Anything that competes with the hero gets removed, not shrunk.
- **Photos are evidence, so they are held to evidence rules.** A photo comes
  from the same event, or it is captioned as context. Every photo has a
  licence record and an on-frame credit (photo-rights-ledger).
- **Real people come from real photographs** (photo-to-poster-portrait). A
  boosted, illustrative portrait is made from a freely licensed photo with
  deterministic filters, never generated. Where no photo exists, use a
  labelled placeholder.

### Anti-patterns

- **The infographic post:** a flat ground, a generic accent and a tidy card.
  It is correct but forgettable, and it is the round-one baseline that loses.
- **Gamer wallpaper:** light leak + grain + vignette + speed lines + sparks +
  glow on one frame. Each layer is fine; together they bury the data.
- **The decorative HUD:** game-UI grammar (segmented bars, kill feeds,
  reticles) that makes values harder to compare and repeats the ranking.
- **The tilted table:** a 3D tilt over 15° on rows or a map. The far rows
  shrink and the north disappears.
- **The stand-in photo passed off as the event:** a photo from another race,
  city or year captioned as if it were the moment.
- **The trick axis:** broken bars, per-series sparkline scales, rounding that
  exaggerates a gap. Viewers misread them at a glance.
- **Lookalike identities:** two entities sharing a colour because they share
  a category (two nations both blue, two products both red).
- **Confetti geography:** small states at phone size carrying information
  nobody can see.
- **The silent newcomer:** a new entry that appears as a dot or a sliver,
  with no smear, flash or chip to make the arrival felt.
- **The generated likeness:** any model-made image of a real person.
- **Dead bands:** an empty strip between header and chart that pushes the
  hero down for no reason.

### Composition order

1. Name the case's **world** (team, brand, era, place, genre) and pull a
   4-to-6 colour palette and one background idea from it. Write down which
   entity "owns" each palette (leader-adaptive-theme).
2. Pick the **chart form** that shows the story's move best
   (case-native-chart-form). Assign one identity colour per entity.
3. Choose the **event device** and its evidence: a photo of the same event
   or a captioned context photo, a date stamp and a headline
   (evidence-card-popup). Log the licence (photo-rights-ledger).
4. Spend the **motion budget**: at most two cues, and say which beat each one
   sells (motion-cue-budget).
5. Lay the frame inside the **safe box** and check the type floor
   (legibility-floor).
6. Review at phone size and strike anything from the anti-pattern list.
7. Record the case's visual breakdown (palette, background logic, chart
   form, event device, motion cues, typography, what makes it unique) so the
   next case starts from a written precedent, not a memory.

### Failure modes

- **Theme as costume:** the palette is borrowed, but the chart form and
  event device are unchanged, so the frame still reads as a template.
- **Evidence without effect:** a vivid card next to data that shows no
  reaction.
- **Effect without evidence:** sparks and smears with no dated event behind
  them.
- **Over-direction:** each frame tries every tool. The budget exists because
  the urge is constant.
- **Legal debt carried into render:** photos with unknown or share-alike
  licences, brand palettes and logos, real likenesses, found only at publish
  time.

## 2 · Per-case visual breakdowns of the winners


The data-video studio from `data-video-virality` (repo: `StatReel`,
narration-free viz-led videos, rendered as stills with a React video
framework) ran two rounds of art-direction triage on five accepted cases.
Round 1 tried three shared directions per case:
- a house "On Air" frame (night ground, one volt accent, a pop-up card);
- a light "Photo Finish" timing-sheet look with pinned annotations;
- a landscape broadcast package.

The owner judged the round-1 winners (search v2, flags v3, F1 v1, FPS v1)
to feel like **"an infographic post"**. Round 2 boosted each winner with
dynamic layered HTML/CSS, a background matching the current leader's
style, and photo evidence pop-ups. The owner accepted these as the fix and
named the unique theme per case as the pattern that "gets the look above
competition". The winners are search v4, flags v4, F1 v4, FPS v5 and
empire v4. The breakdowns below are the written precedent future cases
start from.

### search-box-wars v4: search-engine share, Dec 2017 (real data)

- **Palette:** a light, almost white ground. The leader's four brand colours
  (blue, red, yellow, green) appear only as soft light leaks and a thin
  four-colour top stripe. Each challenger has its own identity colour (teal,
  purple, red-orange, ochre, grey).
- **Background logic:** leader-adaptive. The monopoly holder's palette *is*
  the room. No logo; the headline number "91.8%" is set in four-colour type.
- **Chart form:** a line race of the challengers only (0–6 %). The leader is
  off-scale and shown as a headline number. The hook reframes the story:
  "Everyone else is fighting for 8%".
- **Event device:** a tilted browser-window card holding a real screenshot of
  the browser release that switched its default search, labelled
  "EVIDENCE · 14 NOV 2017", with a hand-drawn red circle on the search box.
- **Motion cues:** a rolling clock (NOV→DEC caught mid-roll) and comet-glow
  line heads with a spark burst at the crossing, plus an
  "▲ #3 · ▼ #4" overtake label.
- **Typography:** condensed heavy sans for the title, mono for the kicker,
  clock and credits, and coloured type for the number.
- **What makes it unique:** the only light frame of the set. The brand world
  is evoked by colour alone, and the evidence is the product itself.

### africa-flags v4: Africa's flags, end of 1960 (real dates, simplified 1960 flags)

- **Palette:** a dark navy ground. Each colony is hatched in its ruling
  power's colour (UK crimson, France blue, Portugal green, Belgium gold,
  Spain orange, South Africa violet). Newcomers have a yellow glow outline.
- **Background logic:** the far plane is a bokeh of the year's own flags, so
  the year's story becomes the room.
- **Chart form:** a flag-filled map on a tilted slab with an extruded shadow,
  plus a glass dated log of the 17 flags raised in 1960 (landscape). The
  log's last entry slides in.
- **Event device:** a polaroid stack. One photo shows a signing on the
  independence day of one state, the other a prime minister on the
  independence day of another. Each has a date caption.
- **Motion cues:** pulse rings on the last flag of the year, and a light
  trail on the newest log entry. The odometer reading 26→27 doubles as the
  counter.
- **Typography:** heavy condensed title, mono dates in the log, a red
  italic tab ("1960: THE YEAR OF AFRICA"), and a giant gold year.
- **What makes it unique:** many flags at once, tied to geography, and the
  ruler colours add a second story layer (who let go first). The vertical
  sibling (v5) adds a broadcast ticker of the year's flags. Keep that
  ticker.

### f1-titles v4: drivers by world titles, end of 1993 (real data)

- **Palette:** the current leader's team livery (navy, yellow, white bands),
  with one identity colour per driver (red, gold, green, blue, orange, cyan,
  lime, pink, teal, violet). This fixed round 1's lookalike blues.
- **Background logic:** leader-adaptive. A blurred photo of the leader's car
  sits on the far plane with diagonal speed lines in the livery colours.
- **Chart form:** segmented bars. Each title is a block labelled with its
  season ('85 '86 '89 '93), so the bar shows the years, not only the count.
- **Event device:** a press photo with an orange camera date stamp ('93 9 26)
  and a yellow caption card: "ESTORIL · 26 SEP 1993 · PROST SEALS TITLE No.4
  — AND RETIRES". The photo is from another race of that season and is
  credited as such.
- **Motion cues:** the new '93 block flies in with a streak and sparks, with
  an ▲4 overtake arrow. The year clock rolls 1992→1993.
- **Typography:** heavy condensed driver names, mono season labels inside
  the blocks, and a giant gold rolling year.
- **What makes it unique:** a bar that carries history (the year blocks), and
  a frame that lives in the leader's livery.

### most-played-fps v5: most-played shooters, Mar 2020 (sample counts, real event)

- **Palette:** a dark green-black ground. Teal HUD lines, one identity colour
  per game, and a red accent for the newcomer and the event banner.
- **Background logic:** the genre's world, an esports HUD grid with a warm
  ember glow in one corner. No game key art.
- **Chart form:** angled, segmented bars (the HUD look) with a "MATCH CLOCK".
  Note: the triage had judged the v4 sibling (plain bars with a key-art
  mood) the more readable product. The owner picked v5 for its stronger
  world, so it is recorded here as a winner, with its legibility debt.
- **Event device:** a lockdown polaroid captioned as context ("March 2020:
  the world stays home") and a red banner, "30M PLAYERS IN 10 DAYS · free-to-
  play".
- **Motion cues:** a scope reticle on the newcomer's bar with a NEW · #1
  chip, and a kill feed reading "★ enters at #1 / ▼ #2 / ▼ #3".
- **Typography:** heavy condensed names, mono HUD labels, and a boxed match
  clock.
- **What makes it unique:** the genre's own interface grammar becomes the
  chart. The context photo grounds a sample-data case in a real moment.

### largest-empire v4: largest empires, 1220 (sample areas, approximate borders)

- **Palette:** a deep night ground with a warm amber light from the leader's
  side. The leader is in gold, the absorbed rival in hatched pink-red, and
  other polities have identity colours.
- **Background logic:** a steppe-dusk sky with stars, plus a light leak from
  the conquering side.
- **Chart form:** an orthographic globe (satellite imagery reprojected per
  pixel, limb darkening, an atmosphere glow, a graticule). Territories sit on
  top. Great-circle arrows push into the absorbed rival, and the ranked list
  is a glass card (+3.9 / −2.3, the loser struck through).
- **Event device:** a manuscript card, "EVIDENCE · 1221", showing a 15th-
  century miniature of a battle of that campaign, with a museum-style label.
- **Motion cues:** the rolling year (1219→1220) and the campaign arrows with
  a glowing dashed front.
- **Typography:** heavy condensed title, mono tags ("SAMPLE DATA",
  "BORDERS ≈"), and a giant gold year with "AD".
- **What makes it unique:** geography finally carries the story (you see the
  rival eaten from the north-east), and the globe can spin across a century.
  Still to borrow from its sibling: the dashed ghost of the later extent and
  a lower-third.

### Patterns across the five

- Every winner has a **world**: brand light, the year's flags, team livery,
  a genre HUD, a steppe night. No two share a ground.
- Every winner shows its event **on the data** (a crossing spark, a glow
  outline, a block landing, a NEW chip, arrows) **and** in a card.
- Every winner keeps the same furniture: a kicker top-left, the clock
  top-right, a progress bar with event ticks, a mono source line, and a
  sample tag where it applies.

## 3 · Techniques (procedures and decision rules)


### Leader-adaptive theme

The far plane of the frame belongs to **whoever leads right now**. It might
show a brand's colours as soft light, a team livery as bands, a nation's flag
colours with a blurred crowd photo, a landscape at the leader's end of a map,
or a fight-poster ground in the champion's colour. The viewer knows who is
winning before reading a bar, and a lead change gets a built-in motion
moment: the world itself changes.

#### Procedure

1. **Name the world of the case**: the brands, teams, nations, era or genre
   the story lives in.
2. **Derive one theme per entity that can lead.** Each theme has a palette
   (4 to 6 colours), a background idea (light leaks, bands, a blurred photo
   plane, rays, a texture) and optionally a type treatment (coloured digits,
   an outline giant numeral on the far plane).
3. **Keep the house invariants fixed** across themes: the clock position, the
   progress bar, the source line, the type families and the safe box. The
   theme changes the world, not the furniture.
4. **Tie the theme to the leader in the engine**, not to the case. On a lead
   change, cross-fade or wipe the far plane over a few frames. Make that
   transition one of the frame's two motion cues.
5. **Keep the data plane neutral enough** that every entity's identity
   colour stays readable on every leader's theme. Test the worst pair.
6. **Write the theme down per case** (palette hex, background recipe, what
   it evokes) so it is restated at every render, not remembered.

#### Decision rules

- When the leader never changes (a monopoly), theme by the **story** instead
  (the challengers' fight, the era), and spend the motion on the race for the
  places below.
- Brand palettes evoke trademarks. Use colour and coloured type, never logos,
  and flag the case for a legal check before publishing.
- A theme must not claim more than the data does. Do not dress a projected
  leader in the winner's world before the data crosses.
- An off-brand case look is allowed and often wins. The house survives in
  the invariants.

#### When not to use it

- **Many-leader churn** (the lead changes every few steps). The world would
  flicker. Theme by the story and mark leads with a badge instead.
- **Cases where the leader's world is a sensitive identity** (a party, a
  religion, a conflict side). Use a neutral story theme.

### Case-native chart form

The default ranked bar race is interchangeable with every other bar race. A
chart form chosen for **this story's move** is a large part of what makes a
frame unique. Examples: a crossing seen as a line race, titles as dated
blocks, territory as a globe, a wave of new states as a flag map with a log.

#### Procedure

1. **Write the story's move in one line**: who crosses whom, what gets
   absorbed, what accumulates, what appears at once.
2. **Match a form to the move:**
   - a crossing or a slow decline: a line race of the contenders, with the
     leader as a headline number if it is off-scale;
   - accumulation of discrete wins: segmented bars whose blocks carry the
     year or event;
   - territory and borders: a globe or a map, with the ranked list as a
     card;
   - many things changing at once in places: a map filled with the entities'
     own symbols, plus a dated log for the time pressure;
   - a newcomer entering at the top: a bar race with an entry smear (a bump
     chart fails, because a newcomer has no line yet);
   - succession of one title: a lineage strip (who held it) with the holder's
     portrait.
3. **Give every entity one identity colour.** Never colour by a category
   that makes two leading entities alike.
4. **Draw the event on the data**: a glowing block landing, a pulse ring, a
   leader line, an overtake arrow, a ghost of the record.
5. **Check the honest encoding**: area for area, a common scale for a
   comparison, no rounding that exaggerates a gap.

#### Decision rules

- If the form hides the story's move at its own event moment (the newcomer
  is a dot, the event is a sliver at the edge), change the form.
- Prefer the form that shows **history at once** when the path is the story.
  Prefer the ranked form when the order is the story.
- Tables and HUDs are legible but static. Use them only when a strong motion
  plan exists (row swaps, flips).
- Geography needs real dated borders. Approximate borders carry a permanent
  tag and are not published as fact.

#### When not to use it

- **A series that has already earned its form.** Keep the form across
  episodes and vary the world instead.

### Evidence-card pop-up

An event beat lands as **news** when the viewer sees evidence: a dated
photo, a screenshot of the product, a page from a manuscript, a press
clipping, a fight bill. A text callout explains; an evidence card proves.
The card sits in an empty pocket of the chart, never over the data that
reacts.

#### Procedure

1. **Find evidence from the same event** first: the launch screenshot, the
   ceremony photo, the race or fight photo, the treaty page.
2. **If only context exists, caption it as context.** "March 2020: the world
   stays home" over a lockdown street is honest. "Lockdown week" over an
   unrelated photo implies more than it shows.
3. **Pick a card grammar native to the case's world**: a browser window, a
   polaroid stack, a press photo with a camera date stamp, a manuscript or
   museum label, a broadcast lower-third, a newspaper clipping, a fight bill.
4. **Put a dated label on it** ("EVIDENCE · date", a camera stamp, a
   headline). The date is the cheapest and strongest truth signal.
5. **Show the effect on the data at the same moment** (glow, pulse, arrow).
   Card and effect are one beat.
6. **Credit the photo on the frame** in a micro-line and in full in the
   description (photo-rights-ledger).

#### Decision rules

- One evidence card per frame. A second card competes and halves both.
- Card headline text at 26 px or more. Sub-captions at 22 px or more, or cut
  them. Credit micro-lines are the only exception.
- A tilt of a few degrees sells "physical object". More than about 6° costs
  legibility.
- No photo of the event exists? A typographic card (a clipping or a
  scorecard) beats a misleading photo.

#### When not to use it

- **Events that are only data** (a crossing with no outside cause). Use an
  on-data badge, not a card.
- **Photos whose subject is a private or vulnerable person.**

### Motion-cue budget

A still from a data video has to read as **a frame from a moving picture**,
and that job is done by a few cues: digits caught mid-roll, sparks at an
overtake, a vertical smear and echo outlines behind a newcomer, a streak on
a block flying in, a ticker blurring off the edge, a pulse ring. Each cue
adds energy. Past two, they add noise.

#### Procedure

1. **List the beats of the frame**: the clock ticking, the event, the lead
   change, the newcomer.
2. **Assign at most two motion cues**, each to a named beat. A cue with no
   beat is decoration and gets cut.
3. **Add one evidence card** (evidence-card-popup). The card is not a
   motion cue.
4. **Count the depth layers separately**: a blurred photo plane, a light
   leak, grain and a vignette. Use two or three of them, not all four plus
   cues.
5. **Review at phone size.** If the eye lands on an effect before the data,
   remove the effect.

#### Decision rules

- Budget: **2 motion cues + 1 evidence card** per frame. Rolling digits count
  as a cue.
- A lead-change background wipe counts as one of the two.
- A newcomer gets its cue (smear, flash, NEW chip), because a silent
  newcomer is the commonest weak event.
- 3D tilt is a layout choice, not a cue. It follows legibility-floor.

#### When not to use it

- **Title cards and end cards**, which can carry one large cue alone.

### Legibility floor

A data video is watched on a phone with the platform's interface on top of
it. A frame that fails at phone size fails, whatever it looks like on a
monitor. These are floors to check on every frame, not targets.

#### Procedure

1. **Story text at 26 px or more at 1080 wide**: titles, values, labels,
   card headlines. Below that, text is decoration, not story.
2. **Micro-credits and source lines at 15 to 18 px** are the one deliberate
   exception. They are credits, not story, and the full credit also goes in
   the description.
3. **Keep content inside the safe box** of the target platform (for a
   1080×1920 vertical, roughly y 150–1580). Keep the right-edge icon column
   mostly clear; only a card corner may reach into it.
4. **Tilt only up to 15°** on anything carrying data (rows, maps, axes), or
   tilt only the background plane.
5. **Check the smallest entity**: small states on a map, a 14 px grid label,
   a one-month sliver. If it carries meaning, enlarge it, call it out, or
   move the meaning to a list.
6. **Review at actual phone size** (about a third of full scale) before
   approving.

#### Decision rules

- When text does not fit at 26 px, cut words, never size.
- Two timelines on one frame (a zoomed strip and a full-run bar) must look
  clearly different, or one goes.
- The empty band at the bottom of a vertical is the platform's, on purpose.
  Do not fill it with story.

#### When not to use it

- **Landscape and big-screen formats.** Rescale the floor; the principle
  holds, the numbers change.

### Photo rights ledger

Every photo in a frame is a legal object as well as evidence. The ledger is
kept **while** photos are chosen, not at publish time. A licence found too
late turns a finished render into a rework.

#### Procedure

1. **One row per image**: the source page URL, the title, the author, the
   licence as tagged at the source, the date taken, what it shows, and
   whether it matches the event or is context.
2. **Credit twice**: a micro-line on the frame and a full row in the
   description or credits.
3. **Note the licence class**:
   - public domain or no known copyright: check the rationale. "Published
     without a valid notice" is country-specific and weaker than an
     explicit release;
   - attribution: credit is enough;
   - share-alike: credit plus a licence note, and confirm with counsel what
     share-alike means for a composite frame;
   - wire or agency photos: treat as high risk even when the archive tags
     them as free.
4. **Note marks and likenesses**: logos in a screenshot, sponsor marks on a
   car, a living person's likeness (publicity rights are separate from
   copyright).
5. **Tier each slot**: A (event-matched and clearly free), B (free but
   context, or another year, captioned with its year), C (nothing usable:
   a labelled placeholder, never a generated stand-in).

#### Decision rules

- No ledger row, no render.
- When a case would ship with any on-screen slot at tier C for more than a
  moment, re-scope the case or accept visible placeholders.
- Brand palettes without logos are lower risk, not no risk. Flag them.

#### When not to use it

- Never skipped. Code-drawn graphics need no row, but the data source line
  still applies.

### Photo-to-poster portrait

Some cases are about people holding something: a title, an office, a
record. A boosted portrait of the current holder makes the frame, but a
generated likeness of a real person is never acceptable. The portrait is
made **from a real, freely licensed photograph** by segmentation and
deterministic image processing. The illustration is a treatment of a real
picture, not an invention.

#### Procedure

1. **Find a free photo from the person's era** (the reign, the term, the
   record), and log it (photo-rights-ledger).
2. **Cut the person out** with a segmentation model (it makes a mask; it
   does not generate pixels). Union two models if one leaves gaps. Fill
   only small holes, keep real gaps between limbs, keep the largest
   component, and feather the edge slightly. Check every mask by eye.
3. **Paint down** with edge-preserving smoothing, then local contrast for
   poster light.
4. **Posterize and gradient-map** into the holder's theme palette
   (leader-adaptive-theme). Blend some continuous tone back in to avoid
   harsh banding.
5. **Add print character**: line art (difference-of-Gaussians ink), an
   amplitude halftone in the shadows, paper texture, plate
   mis-registration.
6. **Light it**: a silhouette glow and a one-sided rim light built from the
   mask.
7. **Run a taste gate on the face and skin**: specular highlights that
   posterize into pale patches read as skin damage. Compress highlights
   before halftoning, and tune levels per photo.
8. **At a change of holder**, wipe the new portrait over the old one along
   a hard seam and change the background world with it. Desaturate the
   outgoing holder.

#### Decision rules

- No free photo? Use a clearly labelled generic silhouette
  ("PHOTO NOT AVAILABLE"), never a generated face.
- Context photos (a later year, a ceremony) are allowed when captioned with
  their year.
- Do not alter facial features, skin tone or body shape beyond the global
  treatment. The treatment is applied to the whole image, never to selected
  features.
- Decorative props drawn in code (a belt, a trophy) stay generic: no real
  organisation's marks.

#### When not to use it

- **Private persons, minors, victims.**
- **Cases where the person's image is the controversy.**

## 4 · Critique learnings behind the rules


The data-video studio from `process--leader-adaptive-theme.md` reviewed 15
round-1 stills (5 cases × 3 directions) and 10 round-2 stills (two boosts
per case). These are the observations behind the budget and the
legibility floor.

### Over-stacking (round 2)

- The two "most designed" frames stacked a light leak, grain, a vignette,
  speed lines, sparks and glow. They sat close to "gamer wallpaper". The
  rule became **2 motion cues + 1 evidence card**.
- The esports-HUD frame was the least readable at phone size: segmented
  bars made values harder to compare, and the kill feed repeated the
  ranking. It still won on world, so the legibility debt is recorded with
  it.

### Tilt (round 2)

- A titles grid tilted 24° on X with extruded blocks and a flag map tilted
  18° both shrank the far rows and the north. The rule became **tilt of 15°
  or less on data, or the background only**.
- A 36° tilted "war table" map read well as atmosphere but cropped a #3
  entity out of view while it was in the list.

### Text size (both rounds)

- Unreadable at phone size: source lines at 17–19 px, flag-wall names at
  14 px, sparkline and legend text, card sub-captions at 14–17 px. The rule
  became **story text at 26 px or more**, with micro-credits as the one
  exception.

### Honesty habits caught

- Largest-remainder rounding in a waffle gave 2 squares to 1.66 % and 1 to
  1.61 %, exaggerating a 0.05-point gap. Per-series sparkline scales
  misled at a glance, and a broken off-scale bar was a trick viewers may
  misread.
- An F1 evidence photo was from another race of the season, and a lockdown
  street was a stand-in. Both were labelled, which led to the rule: **the
  same event, or captioned as context**.
- Nationality colours made four leading drivers the same blue. The fix was
  identity colours per entity.
- Colonies drawn in the colonisers' flags competed for attention. The fix
  was hatching in the ruler's colour, with a legend.

### Weak events (round 1)

- A stacked area put every event on the right edge as a one-month sliver.
- A bump chart showed the newcomer as a single dot at its own event.
- A plain bar race let the card do all the work.
- Round 2 fixed these with a smear and echo outlines on the newcomer, a
  streak and sparks on the landing block, and a glow trail on the newest
  log row.

### Licensing notes kept

- Share-alike photos (CC BY-SA 2.0 and 4.0) need on-screen or description
  attribution and a counsel check for composite frames. A browser
  screenshot carries the vendor's trademark as an incidental mark.
- Brand palettes and team liveries were used without logos. The colours
  still evoke the brands, so they are flagged for legal review.

## 5 · Boxing portrait experiment (photo → poster, no generation)

Frames, credits and a full critique: `image-triage/boxing/BOXING.md` and `sheet.png`.


The data-video studio from `process--leader-adaptive-theme.md` tested a
succession format: "Heavyweight boxing champions over time", following one
belt (the WBC heavyweight title, 1963–2026) on a lineage strip. The current
champion's boosted portrait fills the frame, title defences pop up as
cards, and a winning challenger's portrait wipes over the old one. Hard
rule: no generated image of any real person.

### Photos used (all from a free-licence photo archive)

- Champion portrait: a ring-walk photo from Oct 1987. It is tagged public
  domain under a US "published 1978–89 without a valid notice" rationale
  (magazine scan).
- Defence evidence: a photo from the night of defence #7 (27 Jun 1988,
  KO in 91 seconds). Same rationale, but it is a **wire-agency photo**.
  High risk.
- Challenger portrait: a 1990 photo of the new champion with the belt,
  from a public library's digital collection, under a "No Copyright – United
  States" rights statement.
- Portrait variant: a Dec 1987 magazine portrait, same US rationale.
- No free photo of the upset fight itself was found. The upset card is
  typographic: a clipping with the round, the time, the knockdown and the
  scorecards.

### Pipeline that worked

- Two segmentation models unioned for one photo (the first left the lower
  torso semi-transparent). Holes smaller than 2 % of the subject were
  filled, and a feather of 1.6 px applied. A third, larger model ran out of
  memory on the shared machine.
- Bilateral filter and stylisation, then CLAHE, posterize (4–5 levels, 25 %
  continuous tone blended back), a gradient map in the holder's palette
  (champion red→orange→cream, challenger navy→cyan, outgoing holder grey),
  difference-of-Gaussians ink, an amplitude halftone (22° or 45°), paper
  texture, and plate mis-registration.
- A screenprint variant: a black halftone key plate plus line art over a
  flat red plate offset by a few pixels, on cream paper. It read best at
  phone size.
- The ground was built in CSS and SVG: sunburst rays, halftone dot fields,
  extruded skewed 1980s type, a torn-paper strip, and a generic code-drawn
  belt (no sanctioning-body marks). It was a late-1980s fight-poster world.

### Lessons

- **Skin taste gate:** sweat highlights posterized into cream blotches that
  read like skin damage. Clipping tones above about 0.82 before halftoning
  fixed it. Tune per photo.
- **Mid-wipe frame:** a jagged seam with a hot white edge and sparks, the
  outgoing champion desaturated, and the background world changing from red
  to blue with the seam. The colour change carries the beat.
- **Two timelines on one frame** (the zoomed lineage and the full-run bar)
  were confusable. Keep one, or style them far apart.
- **Scaling risk is photos, not code:** a full run has 26 distinct
  champions. Recent decades have plenty of attribution or share-alike event
  photos. The 1980s–90s are thinnest, often only magazine scans under a
  country-specific rationale, or later photos of the retired fighter. Plan
  per-champion tiers (A era-matched and free, B captioned context, C
  labelled placeholder) before building, and get a publicity-rights check
  for living people.


## 6 · Video rounds v1–v3 (search-box-wars): timing, stacking, titles, ending, logo

Registry techniques added in round 5: `timing-plan-first`, `event-card-stack`, `curiosity-title-thumbnail`,
`top-n-with-logos`, `ending-sequence`, `champion-split-wipe`.

### Timing plan first
- Every render starts with a **timing plan**. Score each period's change density from the data the viewer sees: weighted rank swaps
  in the visible rows, entries and exits, Σ|Δvalue| / axis max, plus a small base. Then set frames ∝ score, clamped (1–10 frames/month),
  Gaussian-smoothed and renormalised, with Gaussian **dwell** bumps around events.
- Save `timing-plan.json` (knots frame → period, frames per period, events, orders) and `TIMING.md` (per-year table, evenness, long-form
  note) **before** rendering. The composition reads the plan and never hard-codes keyframes. Module: `src/timing/timing.mjs`.
- Calm flicker with the **order**, not with time: a 3-month centred average plus hysteresis (overtake only when ahead by 6 % + 0.01 pt),
  documented in the description, not on screen (superseded: the old "ORDER: 3-MO AVG" label breaks the no-explainer-legends rule). Values stay raw. Search case: 575 → 257 top-10 row changes; CV of changes/s 0.54 → 0.21.
- Short ≈ 27 s timeline; a long-form cut = the same curve ×3 (1–3 min) with a higher per-period minimum.

### Event cards: lifespan, stacking, transitions
- A card's lifespan is counted in **frames** from its entry: readable time **+ ~2 s** (≈ 4 s). The timeline keeps running. The card
  carries the event date ("EVENT · 7 FEB 2023"), and the progress bar gets an event tick, so a card may outlive its month honestly.
- **Overlap → stack:** the newer card lands on top, and each older card sinks one level per newer visible card (+24 px x, −62 px y,
  −6 % scale, −12 % brightness). Every card exits on its own clock, even from under the pile. Max depth 3; overlapping cards share an anchor.
- **Transitions vary by card type**, one motion cue each: photo → photo-flash snap / toss out; screenshot → page-flip (top hinge, shaded
  fold); chart-caused event → circular wipe from the chart line head (collapses back into the moving head); fast news → slide with
  horizontal motion blur + skew; data milestone → rubber-stamp drop. A tilt past 15° is allowed only in motion (< 0.4 s); resting
  tilt ≤ 3°. Reusable component: `EventStack` (`src/sv2/eventstack.tsx`).

### Titles and thumbnail
- On-screen title: **one plain line naming the topic** ("Search engine market share, 2009–2026"), one row on a phone, on screen for the
  whole timeline. No in-chart slogan; spend the height on more rows.
- Hook (0–2 s): a **question** ("Who owns the search box?"), the scope, and equal logo tiles. No answer and no outcome words.
- Thumbnail (1080×1920): the question, equal-size logo tiles of the key players with the winner **not** first, and a teaser device
  ("? %" share bar). Data credit and a trademark micro-line.

### Top 10 with logos
- Show the **top 10** from the real data. A dominant #1 gets a true-scale 0–100 % strip; the rest race on their own honest axis (0–6 %).
- Logos: transparent Commons SVG/PNG first, logged (file, page, licence, author, trademark flag), labelled on screen as trademarks
  used for identification; avoid share-alike files; fall back to a clean wordmark. Normalise optical size per logo (small marks like
  Sogou and "Microsoft Bing" get a scale factor).

### Ending sequence
1. **Winner spotlight** (~2 s): the timeline stops, the others dim to ~20 %, the winner scales up ~8 %, one verified result card.
2. **Like & subscribe** (~2 s): "Like & subscribe for more like this", thumbs-up and ringing bell in the video's palette.
3. **Powered by StatReel** (~3 s): the **Frame Stat** logo (see below), recoloured to the video, with bars rising as the build-in.

### StatReel logo: Frame Stat (chosen)
- A film frame with sprocket holes and a rising four-bar chart inside, on a 100×100 grid (`src/sv2/statreel-logo.mjs`, concept C).
  The frame takes the video's ink and the bars take the video's palette; the geometry is never redrawn. Wordmark "Stat" (ink) + "Reel"
  (accent) in Barlow Condensed 800. Colorways exist for Google-influenced, F1 Williams and Africa flags.

### Champion change: boxing t2 split-wipe (preferred)
- When a title or lead changes hands, a **jagged diagonal seam** (top x ≈ 700 → bottom x ≈ 330) splits the frame. The outgoing
  champion is desaturated and pushed out, their record struck through. The incoming one enters in their own palette with a hot white
  seam and sparks (one cue). Only for real champion changes; ordinary rank swaps use eased row moves.

## 7 · Triage protocol: 4 proposals per case (from round 3)

In round 3 the owner rejected exo and then **picked the concept/landing challenger in all four remaining cases**, over data-chart winners chosen earlier:
- gdp: cut-paper skyline over the fan chart
- lex: candle chapel over the vital-signs monitor
- os: balance scale over the share dial
- senna: ghost on the grid over the vertical number line

The approach comes from the `/contest --landing` skill (ai-registry). The owner's taste there is "visually dominant with nested layers and custom illustrative elements" plus "creative and execution excellence", and drawn per-item artwork beats stock icons in a nicer frame. **The owner picks parts, not variants.**

### The rule
**Every triage case gets 4 proposals, made on the same data at the same moment, under every Quick rule above:**

| seats | approach | what it must have |
|---|---|---|
| **A, B** | **concept / landing** | **one strong, non-obvious metaphor that fits the material** (A and B use *different* metaphors); **custom illustrative elements drawn in code** (SVG/CSS: cut-paper, drawn objects, grain, paper shadows); **drawn per-item artwork, not stock icons** (each top-10 entity gets its own object in its identity colour, plus its flag/logo); **nested layers** back / mid / front (a far scene, a middle plate, the hero objects); **overview → zoom lens → detail** (a nested inset that magnifies the decisive gap or moment); **a headline-size claim** ("Tipped by 0.02 points"); a "stylised" note in the source line |
| **C, D** | **data-chart** (the original style) | a case-native chart form (§3), a leader-adaptive world, an evidence card. Still fully eligible to win; it is the stronger choice when **change over time** is the story |

Default to **vertical 1080×1920** (the owner values mobile). Present all four side by side with labels, and note **which parts** of each are worth fusing.

### Known risks and mitigations
| risk (seen in round 3) | mitigation |
|---|---|
| **Small entries get squeezed.** Illustration and depth rows eat room (gdp back row; senna's 22–27-win pack had 6 cars in ~120 px) | Add a **legend strip** (flag + name + value, in rank order, in a clear band), **or a zoom lens** on the crowded region. Never shrink labels below the type floor; move them instead (senna moved its labels into the infield) |
| **Physical metaphors are weak at showing change over time.** A skyline, candle or scale is a snapshot; the earlier winners won on trajectory | Add a **time trace** (a sparkline drawn *on* the object, e.g. os device screens, or a thin trail behind a moving object) **or energy cues on the object** (lex v2: the flame grows and glows while the candle rises; smoke when it falls). *Dashed ghost/target outlines were rejected by the owner in video 03; avoid them in motion*. In motion, let the object grow, burn or travel with the clock |
| **Decoration buries the data** | One dominant element; the motion budget (≤2) and the legibility floor still apply. Tilt exaggeration must be labelled ("tilt exaggerated for legibility") |
| **The metaphor misencodes the value** | One common scale per frame (tower height, candle height, lap distance), stated in the subtitle ("ONE LAP = 90 WINS"); areas by sqrt; projections and counterfactuals visibly different (scaffolding, dashed, ghost) and tagged SPECULATIVE |

### Pattern ledger
One reusable design idea per winner. **Next brief:** give the ledger as the floor ("at least this good") with the instruction **"do not copy these: find this case's own"**. Update the ledger after each owner verdict. *Seen* counts the frames that used the idea (start of ledger: one each); *won* counts final owner picks (r3 runners-up were provisional winners before the v4s were picked).

| idea (transferable philosophy) | winner it came from | won / seen |
|---|---|---|
| **Magnitude as built mass; the future as unfinished structure.** Same-scale objects; projected values drawn as scaffolding or dashed brackets | gdp v4 cut-paper skyline (r3) | 1 / 1 |
| **The past as burned-away memory.** The value is something consumed; the earlier state is a dashed ghost of what was lost (*in motion, video 03 v2 replaced the ghost with flame energy: owner rejected the outline*) | lex v4 candle chapel (r3) | 1 / 1 |
| **Weigh the gap.** A near-tie becomes a physical tilt; each side's history is drawn on its own object (sparkline on the device screen) | os v4 balance scale (r3) | 1 / 1 |
| **Counts as distance on the subject's own course.** The unit is mapped onto a loop native to the story; a ghost runner carries the counterfactual; a lens freezes the pass | senna v4 ghost on the grid (r3) | 1 / 1 |
| **Show the uncertainty as a fan** that opens beyond the last real value | gdp v1 fan chart (r3 runner-up) | 0 / 1 |
| **The domain's own instrument is the chart** (a vital-signs monitor for mortality) | lex v2 monitor (r3 runner-up) | 0 / 1 |
| **History as a sweep.** A dial whose angle is time and whose wedge is share | os v3 share dial (r3 runner-up) | 0 / 1 |
| **Altitude with a ghost.** A vertical number line where the counterfactual floats above the real record | senna v1 (r3 runner-up) | 0 / 1 |
| **The leader's palette is the room; an off-scale leader becomes a headline number** | search-box-wars v4 (r2) | 1 / 1 |
| **The year's own symbols fill the map**, plus a dated log for time pressure | africa-flags v4 (r2) | 1 / 1 |
| **A bar that carries history**: segments labelled with their year | f1-titles v4 (r2) | 1 / 1 |
| **The genre's interface grammar becomes the chart** (HUD) | most-played-fps v5 (r2) | 1 / 1 |
| **Geography carries the story**: a globe with campaign arrows | largest-empire v4 (r2) | 1 / 1 |
| **Count by hand.** One drawn mark per unit (a chalk stroke per week) on a surface native to the subject; bundles of five keep it countable; the lens lands on the decisive mark | weeks v2 chalk tallies (r4) | 1 / 1 |
| **The object shrinks with the value.** The thing being measured is itself the bar (a banknote whose width is its dollar value), with the lost part hatched. A literal "bar in costume" can win when the costume *is* the subject | dollar v2 shrinking banknotes (r4) | 1 / 1 |
| **A plain multi-line history beats a costume when the story is a long crossover** (top-5 lines over 20 years, logo grid) | code v3 line chart (r4) | 1 / 1 |
| **The record as a complete set.** Map the record onto an object with a native count (36 spokes on a wheel) so "one short of full" and future ghost units read instantly | tdf v1 spoke wheel (r4) | 1 / 1 |
| **Units as the subject's own token.** Hanging ticket strips from a marquee (1 ticket = $200M); the lens on the last token shows the margin | boxoffice v1 ticket strips (r4) | 1 / 1 |
| *Fill a container* (hourglass sand, popcorn level, banknote width) | weeks v1, boxoffice v2 (r4); dollar v2 is a cousin | 0 / 2 (+dollar v2 won) |

Cross-cutting philosophy, seen in 6 of the 9 winners up to r3: **the subject's own object is the chart** (skyline, candle, scale, track, HUD, globe).
After r4 (owner picks: weeks v2, dollar v2, code v3, tdf v1, boxoffice v1): the subject's own object/token again wins 4 of 5 (slate, banknote, wheel, ticket), and 1 of 5 went to a plain chart (code v3), so chart seats stay live.
**Note on containers:** generic fills (hourglass, popcorn bucket) lost in r4, but dollar v2, which I had called the weakest ("a bar chart in costume"), won. So the lesson is not "containers are worn". It is **"use the subject's own object as the bar"**: a banknote measuring money works; a generic vessel standing in for anything does not. Don't dismiss literal encodings when the object is the subject.


### Triage prompt template (give this to whoever makes the prototypes)
```
You are making image-triage prototypes for StatReel, a narration-free data-video studio.
CASE: <slug> — <one-line story>. MOMENT: <date / mid-video event>. DATA: <file, real values, source line>.
LEADER at the moment: <entity> → the background follows its world/colours.
EVIDENCE PHOTO: <file, licence, credit> (real, licensed; never AI images of real people).

Make 4 stills, vertical 1080×1920, all on the SAME data and moment:
  A, B = CONCEPT / LANDING seats. Each picks ONE strong metaphor that fits the material and would
         not be the obvious first idea; A and B must use DIFFERENT metaphors ("three skins lose to one
         strong idea"). Required: custom illustrative elements drawn in code (SVG/CSS — cut-paper,
         drawn objects, grain, paper shadows); drawn per-item artwork for every top-10 entity in its
         identity colour (plus its flag/logo), never stock icons; nested layers back / mid / front;
         overview → zoom lens → detail (a nested inset on the decisive gap or moment); a headline-size
         claim; one dominant element; "stylised" noted in the source line.
  C, D = DATA-CHART seats: a case-native chart form, leader-adaptive world, evidence card. These can win.

Hard rules for all 4 (ART-DIRECTION.md Quick rules): side-reveal photo card caught mid-slide, alternating
sides across seats; top 10 with logos/flags; story text ≥26 px; content in y 150–1580, right column
x ≳ 960 mostly clear; ≤2 motion cues; SPECULATIVE / SAMPLE tags where relevant; one common scale per
frame stated on screen; Frame Stat brand mark; source + photo credit on frame.

Known risks you must handle: crowded small entries → a legend strip or a zoom lens (never shrink below
the floor); physical metaphors hide change over time → a time trace on the object or a burned/ghost
memory device.
Pattern ledger (the floor — do NOT copy these, find this case's own): <paste the ledger table>.

Deliver: <slug>/A–D.png, a labelled side-by-side sheet, and per seat a NOTES block:
Philosophy / How it stays readable / The wow moment / Known limits / Parts worth fusing.
Inspect every PNG at phone size and fix overlaps, clipping and safe-zone breaks before handing over.
```
