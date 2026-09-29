"""Stage StatReel material for a /contest brief.

    uv run --no-project python scripts/stage-contest-data.py <out-dir>

Writes <out-dir>/data/: sources, use cases, heatmap cells, sample projects, an F1 era sample,
a video script, constraints, the OFL fonts, and SCHEMA.md. Every dataset is written twice:
`<name>.json` and `<name>.js` (setting `window.STATREEL.<name>`) so a page opened from disk can
load it without fetch().

Real vs synthetic: sources and use cases are read from DESIGN.md (Appendix A/B); heatmap cells are
DERIVED from them by the DESIGN.md §7 rule over registry-declared kinds (no capability test has run
yet). Projects, metrics and the F1 era figures are synthetic and flagged as such.
"""

from __future__ import annotations

import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPORTS = ["F1", "NBA", "NHL", "Soccer"]
CLASS_RANK = {"legal": 0, "non_commercial": 1, "paid": 2}
ALLOWED = {"monetized": {"legal"}, "non_commercial": {"legal", "non_commercial"}}


def table_after(md: str, heading: str) -> list[list[str]]:
    block = md.split(heading, 1)[1]
    rows = []
    for line in block.splitlines()[1:]:
        if not line.startswith("|"):
            if rows:
                break
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if set("".join(cells)) <= set("-: "):
            continue
        rows.append(cells)
    return rows[1:]  # drop header


def parse_sources(md: str) -> list[dict]:
    out = []
    for sid, sport, verdict, lic, kinds, notes in table_after(md, "## Appendix A"):
        raw_verdict = verdict
        v = verdict.split(" ")[0]
        kind_list = [k.strip() for k in re.sub(r"\(.*?\)", "", kinds).split(",") if k.strip() and k.strip() != "—"]
        partial = ["hist"] if "hist partial" in kinds else []
        out.append({
            "id": sid,
            "sport": "all" if sport == "all" else sport,
            "verdict": v,
            "verdict_note": raw_verdict[len(v):].strip(" ()") or None,
            "license": lic,
            "kinds": kind_list,
            "partial_kinds": partial,
            "notes": notes if notes != "—" else None,
        })
    return out


USECASE_BLURB = {
    "counterfactual-timelines": ("Counterfactual timelines", "What if the title had gone the other way? A ghost line runs the alternate history beside the real one."),
    "era-adjusted-rankings": ("Era-adjusted rankings", "Raw totals vs era-adjusted value: who climbs, who falls, when you normalise for the era."),
    "spatial-career-maps": ("Spatial career maps", "Every shot of a career on one pitch, rink or court, drawn in the order it happened."),
    "network-flow-timelines": ("Network & flow", "Pass networks and transfer flows animated over a season."),
    "distribution-races": ("Distribution races", "Ridgelines racing through decades: how the shape of a stat changed."),
    "probability-narratives": ("Probability narratives", "A match retold as a win-probability line, with the swing moments called out."),
    "similarity-dna": ("Similarity / DNA", "Players placed by statistical likeness; today's star next to their historical twin."),
    "metric-explainer-shorts": ("Metric explainer shorts", "One advanced metric (xT, PPDA...) explained in under a minute."),
    "reactive-weekend-pipeline": ("Reactive weekend", "A short produced from Sunday's results before Monday morning."),
    "interactive-companion-loop": ("Interactive companion", "A web companion viewers can explore after the video (later)."),
}


def parse_usecases(md: str) -> list[dict]:
    out = []
    for uid, stage, kinds, fmt, notes in table_after(md, "## Appendix B"):
        name, blurb = USECASE_BLURB[uid]
        out.append({
            "id": uid,
            "name": name,
            "blurb": blurb,
            "stage": int(stage),
            "requires": [k.strip() for k in kinds.split(",")],
            "default_format": fmt,
            "notes": notes.replace("**", ""),
            # Nothing is implemented yet; era-adjusted is the M1 walking-skeleton composition.
            "composition": {"status": "planned-m1", "name": "EraAdjustedSlope"} if uid == "era-adjusted-rankings" else {"status": "not-started", "name": None},
        })
    return out


def derive_cells(sources: list[dict], usecases: list[dict]) -> list[dict]:
    """DESIGN.md §7 over registry-declared kinds. `go` needs an implemented composition; the M1
    composition counts as implemented only in the `m1_projection` status so designers see Go cells."""
    cells = []
    for uc in usecases:
        for sport in SPORTS:
            pool = [s for s in sources if s["sport"] in (sport, "all") and s["verdict"] != "avoid"]
            for mode, allowed in ALLOWED.items():
                per_kind, status_parts = [], []
                for kind in uc["requires"]:
                    cands = sorted((s for s in pool if kind in s["kinds"]), key=lambda s: CLASS_RANK[s["verdict"]])
                    avoided = [s["id"] for s in sources if s["sport"] in (sport, "all") and s["verdict"] == "avoid"]
                    if not cands:
                        per_kind.append({"kind": kind, "best": None, "sources": [], "avoided_sources": avoided})
                        status_parts.append("blocked")
                        continue
                    best = cands[0]["verdict"]
                    per_kind.append({"kind": kind, "best": best,
                                     "sources": [{"id": s["id"], "license_class": s["verdict"]} for s in cands],
                                     "avoided_sources": avoided})
                    status_parts.append("ok" if best in allowed else "ask")
                if "blocked" in status_parts:
                    data_status = "blocked"
                elif "ask" in status_parts:
                    data_status = "ask"
                else:
                    data_status = "data-ready"
                projected = data_status
                if data_status == "data-ready" and uc["composition"]["status"] == "planned-m1" and sport == "F1":
                    projected = "go"
                reason = {
                    "blocked": "no registry source declares " + ", ".join(k["kind"] for k in per_kind if k["best"] is None),
                    "ask": "best source for " + ", ".join(k["kind"] for k in per_kind if k["best"] and k["best"] not in allowed) + " is not licensed for this mode",
                    "data-ready": "every required kind has an allowed source; composition not built yet",
                    "go": "data allowed and composition implemented",
                }
                cells.append({
                    "usecase": uc["id"], "sport": sport, "mode": mode,
                    "status": data_status, "status_m1_projection": projected,
                    "reason": reason[data_status], "reason_m1_projection": reason[projected],
                    "kinds": per_kind, "basis": "registry-declared", "tests_run": 0,
                })
    return cells


SAMPLE_PROJECTS = [
    ("p-001", "Who really dominated F1? Titles, era-adjusted", "era-adjusted-rankings", "F1", "vertical", "monetized", "published", 48210, 0.61),
    ("p-002", "Schumacher vs Hamilton vs Verstappen: per-start value", "era-adjusted-rankings", "F1", "vertical", "monetized", "gated", None, None),
    ("p-003", "The 1950s were a different sport: F1 win rates", "era-adjusted-rankings", "F1", "landscape", "monetized", "rendered", None, None),
    ("p-004", "What if 2008 ended one corner earlier?", "counterfactual-timelines", "F1", "landscape", "monetized", "scripted", None, None),
    ("p-005", "Messi's 2017/18 in every shot", "spatial-career-maps", "Soccer", "landscape", "monetized", "data-ready", None, None),
    ("p-006", "xT in 45 seconds", "metric-explainer-shorts", "Soccer", "vertical", "monetized", "idea", None, None),
    ("p-007", "How NBA scoring changed shape since 1980", "distribution-races", "NBA", "landscape", "monetized", "idea", None, None),
    ("p-008", "The pass network that won the 2018 World Cup", "network-flow-timelines", "Soccer", "landscape", "monetized", "published", 12950, 0.48),
    ("p-009", "NHL shot maps: the slot is shrinking", "spatial-career-maps", "NHL", "vertical", "non_commercial", "scripted", None, None),
    ("p-010", "Your favourite striker's statistical twin", "similarity-dna", "Soccer", "landscape", "non_commercial", "idea", None, None),
    ("p-011", "Constructors' titles, era-adjusted", "era-adjusted-rankings", "F1", "vertical", "monetized", "published", 91800, 0.67),
    ("p-012", "Sunday's race in 60 seconds", "reactive-weekend-pipeline", "F1", "vertical", "non_commercial", "idea", None, None),
]
STAGES = ["idea", "data-ready", "scripted", "rendered", "gated", "published"]


def sample_projects() -> list[dict]:
    out = []
    for i, (pid, title, uc, sport, fmt, mode, status, views, avd) in enumerate(SAMPLE_PROJECTS):
        spark = None
        if views:
            # deterministic synthetic 14-day curve: fast rise, long tail
            spark = [round(views * (1 - 0.82 ** (d + 1)) / 14 * (1.6 if d < 3 else 0.9 ** (d - 2))) for d in range(14)]
        out.append({
            "id": pid, "title": title, "usecase": uc, "sport": sport, "format": fmt, "mode": mode,
            "status": status, "stage_index": STAGES.index(status),
            "duration_s": [58, 52, 94, 110, None, 45, None, 102, 61, None, 55, None][i],
            "updated": f"2026-09-{29 - i:02d}",
            "platforms": {"youtube": "private", "tiktok": "draft", "instagram": None} if status == "published" else {},
            "metrics": None if not views else {"views": views, "avg_view_pct": avd, "likes": views // 23, "comments": views // 310, "shares": views // 140, "daily_views": spark},
            "synthetic": True,
        })
    return out


# Approximate career figures through the 2024 season, from memory of the public record -
# ILLUSTRATIVE ONLY until mart_era_adjusted exists. `adj_index` is invented.
F1_ERA = [
    ("Lewis Hamilton", 2007, 2024, 356, 105, 7), ("Michael Schumacher", 1991, 2012, 306, 91, 7),
    ("Max Verstappen", 2015, 2024, 209, 63, 4), ("Sebastian Vettel", 2007, 2022, 299, 53, 4),
    ("Alain Prost", 1980, 1993, 199, 51, 4), ("Ayrton Senna", 1984, 1994, 161, 41, 3),
    ("Fernando Alonso", 2001, 2024, 401, 32, 2), ("Nigel Mansell", 1980, 1995, 187, 31, 1),
    ("Jackie Stewart", 1965, 1973, 99, 27, 3), ("Jim Clark", 1960, 1968, 72, 25, 2),
    ("Niki Lauda", 1971, 1985, 171, 25, 3), ("Juan Manuel Fangio", 1950, 1958, 51, 24, 5),
    ("Nelson Piquet", 1978, 1991, 204, 23, 3), ("Nico Rosberg", 2006, 2016, 206, 23, 1),
    ("Damon Hill", 1992, 1999, 115, 22, 1), ("Alberto Ascari", 1950, 1955, 32, 13, 2),
]


def f1_era() -> dict:
    rows = []
    for name, a, b, starts, wins, titles in F1_ERA:
        rate = wins / starts
        rows.append({"driver": name, "first_season": a, "last_season": b, "starts": starts, "wins": wins,
                     "titles": titles, "win_rate": round(rate, 3)})
    by_wins = sorted(rows, key=lambda r: -r["wins"])
    by_rate = sorted(rows, key=lambda r: -r["win_rate"])
    for i, r in enumerate(by_wins):
        r["rank_raw"] = i + 1
    for i, r in enumerate(by_rate):
        r["rank_adjusted"] = i + 1
    return {"metric_raw": "career wins", "metric_adjusted": "wins per start (stand-in for the era-adjusted index)",
            "rows": rows, "synthetic": "approximate public-record figures through 2024; adjusted rank is a stand-in", "attribution": "Data: F1DB (CC BY 4.0)"}


VIDEO_SCRIPT = {
    "project": "p-001", "format": "vertical", "fps": 30, "duration_s": 58,
    "hook_shape": "contradiction",
    "scenes": [
        {"id": "hook", "start_s": 0, "end_s": 3.2, "on_screen": "Most wins ≠ most dominant", "narration": "The driver with the most wins isn't the most dominant."},
        {"id": "context", "start_s": 3.2, "end_s": 14, "on_screen": "Raw career wins", "narration": "Hamilton leads with one hundred and five wins. Schumacher ninety-one. Verstappen sixty-three."},
        {"id": "turn", "start_s": 14, "end_s": 22, "on_screen": "But seasons got longer", "narration": "But a 1950s season had eight races. Today's has twenty-four."},
        {"id": "reveal", "start_s": 22, "end_s": 44, "on_screen": "Wins per start", "narration": "Rank them by wins per start and Fangio jumps from twelfth to first: twenty-four wins from fifty-one starts."},
        {"id": "payoff", "start_s": 44, "end_s": 54, "on_screen": "Fangio 47% · Ascari 41% · Clark 35%", "narration": "Nearly one win every two races. Nobody has matched it since."},
        {"id": "reframe", "start_s": 54, "end_s": 58, "on_screen": "So who was the most dominant?", "narration": "So: most wins, or most dominant?"},
    ],
    "tracks": [
        {"kind": "voice", "provider": "elevenlabs", "segments": 6},
        {"kind": "music", "provider": "elevenlabs", "cues": [{"start_s": 0, "end_s": 14}, {"start_s": 22, "end_s": 58}]},
        {"kind": "captions", "burned_in": True, "max_cps": 17.8},
    ],
    "synthetic": True,
}

CONSTRAINTS = {
    "formats": {"vertical": [1080, 1920], "landscape": [1920, 1080], "fps": 30},
    "safe_zone_vertical_px": {"top": 270, "bottom": 670, "left": 65, "right": 130, "critical_box": [885, 980]},
    "captions": {"max_lines": 2, "chars_per_line_vertical": 32, "chars_per_line_landscape": 42, "cps_target": [15, 17], "cps_max": 20},
    "pipeline_stages": STAGES,
    "heatmap_statuses": {
        "go": "every required data kind has an allowed source AND the composition is implemented",
        "data-ready": "data allowed, composition not built yet",
        "ask": "best source is non-commercial (in monetized mode) or paid - needs permission or a licence",
        "blocked": "no source, failing capability tests, or source terms need review",
    },
    "modes": {"monetized": "only 'legal' sources", "non_commercial": "'legal' and 'non_commercial' sources"},
    "fonts": {"display_numerals": "Barlow Condensed (500-800, has tnum)", "ui_body": "Inter (variable, enable tnum)", "data_labels": "JetBrains Mono (variable, monospace)"},
}


SCHEMA_MD = """# data/ - StatReel contest material

Load from a page opened from disk with `<script src="data/<name>.js"></script>`; each sets
`window.STATREEL.<name>`. The same content is in `<name>.json`.

## Honesty rules (read first)
- **REAL (from the approved design):** `sources`, `usecases`, `constraints`.
- **DERIVED:** `heatmap` - computed from `sources` x `usecases` by the design's rule over the kinds each
  source *declares*. No capability test has run yet (`tests_run: 0`, `basis: "registry-declared"`), and
  no composition exists yet. `status` is today's truth (no cell is `go`); `status_m1_projection` is the
  state after milestone M1 ships the era-adjusted F1 composition - use it to design the `go` state, and
  make the difference between "today" and "projected" visible if you show both.
- **SYNTHETIC:** `projects`, their `metrics`, `f1_era`, `video_script`. They show the real shape; the
  values are invented or approximate. Do not present them as facts about real athletes beyond what is
  here.

## sources (31) - the licence-aware source registry
`id`, `sport` (F1|NBA|NHL|Soccer|all), `verdict` (legal = monetized OK | non_commercial | paid | avoid =
never fetched), `verdict_note` (e.g. "automated", "credit", "provisional"), `license`, `kinds[]` (hist,
bio, events, track, live, money), `partial_kinds[]`, `notes`.

## usecases (10) - video formats the studio can produce
`id`, `name`, `blurb`, `stage` (3-7, rough complexity/maturity), `requires[]` (data kinds),
`default_format` (vertical 9:16 | landscape 16:9), `notes`, `composition.status`
(planned-m1 | not-started), `composition.name`.

## heatmap (80 cells = 10 use cases x 4 sports x 2 modes)
`usecase`, `sport`, `mode` (monetized | non_commercial), `status` / `status_m1_projection`
(go | data-ready | ask | blocked), `reason` / `reason_m1_projection`, `kinds[]` per required kind:
`{kind, best (licence class or null), sources[{id, license_class}], avoided_sources[]}`, `basis`,
`tests_run`.

## projects (12, synthetic)
`id`, `title`, `usecase`, `sport`, `format`, `mode`, `status` (idea -> data-ready -> scripted -> rendered
-> gated -> published), `stage_index`, `duration_s|null`, `updated`, `platforms` ({youtube|tiktok|
instagram: private|draft|null} - v1 publishes private/draft only), `metrics|null` ({views, avg_view_pct,
likes, comments, shares, daily_views[14]}).

## f1_era (synthetic/approximate)
`rows[]`: `driver`, `first_season`, `last_season`, `starts`, `wins`, `titles`, `win_rate`, `rank_raw`,
`rank_adjusted`. The M1 video is a slopegraph from raw rank to adjusted rank. `attribution` must appear
wherever the data is shown.

## video_script (synthetic) - the M1 short, scene by scene
`scenes[]`: `id`, `start_s`, `end_s`, `on_screen`, `narration`; `tracks[]` (voice, music cues, captions).

## constraints
Video formats, the vertical safe zone (union of TikTok/Reels/Shorts), caption rules, pipeline stages,
heatmap status definitions, modes, the font roles.

## fonts/ (OFL 1.1, self-hosted - the only faces allowed)
`barlow-condensed/BarlowCondensed-{500,600,700,800}.woff2`, `inter/Inter-Variable.woff2` (wght 100-900),
`jetbrains-mono/JetBrainsMono-Variable.woff2` (wght 100-800). Declare them with `@font-face` pointing at
these files; numbers use `font-variant-numeric: tabular-nums`.
"""


def write(data_dir: Path, name: str, value) -> None:
    text = json.dumps(value, ensure_ascii=False, indent=1)
    json.loads(text)  # parse check before anything reads it
    (data_dir / f"{name}.json").write_text(text, encoding="utf-8")
    (data_dir / f"{name}.js").write_text(
        f"window.STATREEL = window.STATREEL || {{}};\nwindow.STATREEL.{name} = {text};\n", encoding="utf-8")


def main() -> None:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / ".contest" / "staging"
    data = out / "data"
    data.mkdir(parents=True, exist_ok=True)
    md = (ROOT / "DESIGN.md").read_text(encoding="utf-8")
    sources, usecases = parse_sources(md), parse_usecases(md)
    assert len(sources) == 31, len(sources)
    assert len(usecases) == 10, len(usecases)
    cells = derive_cells(sources, usecases)
    for name, value in [("sources", sources), ("usecases", usecases), ("heatmap", cells),
                        ("projects", sample_projects()), ("f1_era", f1_era()),
                        ("video_script", VIDEO_SCRIPT), ("constraints", CONSTRAINTS)]:
        write(data, name, value)
    (data / "SCHEMA.md").write_text(SCHEMA_MD, encoding="utf-8")
    if (data / "fonts").exists():
        shutil.rmtree(data / "fonts")
    shutil.copytree(ROOT / "fonts", data / "fonts", ignore=shutil.ignore_patterns("*.json"))
    tally: dict[str, int] = {}
    for c in cells:
        key = f"{c['mode']}:{c['status']}"
        tally[key] = tally.get(key, 0) + 1
    print(f"staged {data}: {len(sources)} sources, {len(usecases)} use cases, {len(cells)} cells {tally}")


if __name__ == "__main__":
    main()
