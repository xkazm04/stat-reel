/**
 * Visual parts of DataRace: logo tile, bar rows, event card, event stack. Everything reads colours
 * from `videoTheme` (design-tokens) by name; entity colours come from props. Every readable text is
 * >= 28 px at 1080 wide, numbers use tabular figures.
 */
import { videoTheme } from "@statreel/design-tokens";
import type { DataRaceProps } from "@statreel/schemas";
import { measureText } from "@statreel/viz";
import type { CSSProperties, ReactElement } from "react";
import { Img } from "remotion";
import { CHIP, type RowChip } from "./chips";
import { relativeLuminance } from "./contrast";
import { L, LABEL_RIGHT, cardLayout, nameLayout } from "./layout";
import type { CardState, RaceRow } from "./state";
import type { TickMark } from "./tick-fade";

export { L, LABEL_RIGHT };

type Entity = DataRaceProps["entities"][number];
type Event = DataRaceProps["events"][number];
type ValueFormat = DataRaceProps["value_format"];

export const TNUM: CSSProperties = { fontVariantNumeric: "tabular-nums", fontFeatureSettings: '"tnum" 1' };
const T = videoTheme;

/** Black or white ink, whichever contrasts more with `hex`. */
export function onColor(hex: string): string {
  return relativeLuminance(hex) > 0.35 ? "#12161a" : "#ffffff";
}

export function formatValue(v: number, f: ValueFormat | undefined): string {
  const d = f?.decimals ?? 1;
  return `${f?.prefix ?? ""}${v.toFixed(d)}${f?.suffix ?? ""}`;
}

/** Logo plate: an asset file on a neutral plate, or the wordmark fallback (a letter tile in the entity colour). */
export function LogoTile({ entity, size, radius }: { entity: Entity; size: number; radius?: number }): ReactElement {
  const r = radius ?? Math.round(size * 0.2);
  if (entity.logo.kind === "file" && entity.logo.src) {
    return (
      <div
        data-logo="file"
        style={{ width: size, height: size, borderRadius: r, background: "#ffffff", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `inset 0 0 0 3px ${entity.color}` }}
      >
        <Img alt="" src={entity.logo.src} style={{ width: "74%", height: "74%", objectFit: "contain" }} />
      </div>
    );
  }
  return (
    <div
      data-logo="wordmark"
      style={{ width: size, height: size, borderRadius: r, background: entity.color, color: onColor(entity.color), display: "flex", alignItems: "center", justifyContent: "center", fontFamily: T.fonts.display, fontWeight: 800, fontSize: Math.max(28, Math.round(size * 0.66)), lineHeight: 1 }}
    >
      {entity.name.slice(0, 1).toUpperCase()}
    </div>
  );
}

/** Measured lines of one text slot, one nowrap block each (keys = the line plus its occurrence, never an index). */
export function Lines({ lines }: { lines: readonly string[] }): ReactElement {
  const seen = new Map<string, number>();
  return (
    <>
      {lines.map((line) => {
        const n = seen.get(line) ?? 0;
        seen.set(line, n + 1);
        return (
          <div key={`${line}#${n}`} style={{ whiteSpace: "nowrap" }}>
            {line}
          </div>
        );
      })}
    </>
  );
}

/** Width in px of mono text (value labels, chips, tick labels): the real advances, rounded up. */
const monoWidth = (text: string, size: number, weight: number): number => Math.ceil(measureText(text, size, "mono", 0, weight));

/**
 * Where the value label sits, relative to the row (row x = marginX). It follows the bar end, but a
 * long prefix/suffix or a bar near full width would cross x 965, so it is shifted left to stay
 * inside and gets a plate so it stays readable where it overlaps the bar tip.
 */
export function valueLabelLayout(barW: number, text: string, size = 30, extra = 0): { left: number; width: number; plate: boolean } {
  const width = monoWidth(text, size, 700) + extra;
  const natural = L.barX - L.marginX + barW + 14;
  const max = LABEL_RIGHT - L.marginX - width;
  return natural <= max ? { left: natural, width, plate: false } : { left: max, width, plate: true };
}

const chipEase = (x: number): number => {
  const c = Math.max(0, Math.min(1, x));
  return 1 + 2.70158 * (c - 1) ** 3 + 1.70158 * (c - 1) ** 2;
};

/** Estimated width of a chip incl. its leading gap (the end label reserves it for the x 965 clamp). */
export const chipWidth = (chip: RowChip): number => 10 + 20 + monoWidth(chip.text, 28, 800) + (chip.kind === "up" ? 22 : 0);

/**
 * "Up N" / "NEW" chip. Filled with `accentInk` and lettered in the sheet colour (>= 4.5:1), 28 px.
 * Only the entrance of a `cue` chip animates (scale pop, `chips.ts` budget); the last frames fade.
 */
export function RankChip({ chip }: { chip: RowChip }): ReactElement {
  const pop = chip.cue ? Math.max(0.01, chipEase(chip.age / CHIP.enter)) : 1;
  const fade = Math.max(0, Math.min(1, (CHIP.frames - chip.age) / CHIP.exit));
  return (
    <span
      data-chip={chip.kind}
      data-chip-cue={chip.cue && chip.age < CHIP.enter ? "1" : "0"}
      style={{ marginLeft: 10, height: 40, padding: "0 10px", borderRadius: 20, boxSizing: "border-box", display: "inline-flex", alignItems: "center", gap: 6, background: T.accentInk, color: T.surface, fontFamily: T.fonts.data, fontWeight: 800, fontSize: 28, lineHeight: 1, opacity: fade, transform: `scale(${pop.toFixed(3)})`, transformOrigin: "0% 50%", ...TNUM }}
    >
      {chip.kind === "up" ? (
        <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 1 15 14H1z" fill={T.surface} />
        </svg>
      ) : null}
      {chip.text}
    </span>
  );
}

/**
 * Gridlines and their labels, behind the rows. The axis maximum grows with the race, so the gridline
 * set changes (tick-fade.ts, one `niceTicks` from packages/viz): each tick carries an `alpha` and
 * fades in or out over a fixed frame window instead of popping. Positions follow the current max.
 */
export function AxisTicks({ ticks, axisMax, rows, format }: { ticks: readonly TickMark[]; axisMax: number; rows: number; format: ValueFormat | undefined }): ReactElement {
  const bottom = L.barsTop + L.rowH * rows;
  return (
    <>
      {ticks.map((t) => {
        const x = L.barX + (t.value / axisMax) * L.barMaxW;
        const label = formatValue(t.value, { prefix: "", suffix: "", ...format, decimals: t.decimals });
        const w = monoWidth(label, 28, 600);
        const left = Math.min(x - w / 2, LABEL_RIGHT - w);
        return (
          <div key={t.value} data-tick={t.value} data-tick-alpha={t.alpha.toFixed(3)} style={{ opacity: t.alpha }}>
            <div style={{ position: "absolute", left: x - 1, top: L.barsTop, width: 2, height: bottom - L.barsTop, background: T.grid }} />
            <div style={{ position: "absolute", left, top: bottom + 6, width: w, height: 36, display: "flex", justifyContent: "center", alignItems: "center", fontFamily: T.fonts.data, fontWeight: 600, fontSize: 28, color: T.inkFaint, whiteSpace: "nowrap", ...TNUM }}>
              {label}
            </div>
          </div>
        );
      })}
    </>
  );
}

/**
 * One bar row. `dim` (0..1, default 1) multiplies the row opacity and `scale` (default 1) enlarges
 * the entity mark (logo, name, bar) from its left edge; the value label follows the scaled bar end
 * at its own size. The ending spotlight uses both: others dim to 20 %, the winner scales ~8 %.
 */
export function BarRow({ entity, row, axisMax, format, dim = 1, scale = 1 }: { entity: Entity; row: RaceRow; axisMax: number; format: ValueFormat | undefined; dim?: number; scale?: number }): ReactElement | null {
  if (row.presence <= 0.001) return null;
  const w = Math.max(6, Math.min(1, row.value / axisMax) * L.barMaxW);
  const top = L.barsTop + row.pos * L.rowH;
  const text = formatValue(row.value, format);
  const name = nameLayout(entity.name);
  const shift = (L.barX - L.marginX + w) * (scale - 1);
  const label = valueLabelLayout(w + shift, text, 30, row.chip ? chipWidth(row.chip) : 0);
  return (
    <div data-row={entity.id} style={{ position: "absolute", left: L.marginX, top, width: L.width - 2 * L.marginX, height: L.rowH, opacity: row.presence * dim }}>
      <div data-mark="" style={{ position: "absolute", inset: 0, transform: scale === 1 ? undefined : `scale(${scale.toFixed(3)})`, transformOrigin: "0% 50%" }}>
      <div style={{ position: "absolute", left: 0, top: (L.rowH - L.tile) / 2 }}>
        <LogoTile entity={entity} size={L.tile} />
      </div>
      <div
        data-name=""
        style={{ position: "absolute", left: L.nameX - L.marginX, top: 0, width: L.nameW, height: L.rowH, display: "flex", flexDirection: "column", justifyContent: "center", fontFamily: T.fonts.display, fontWeight: 700, fontSize: name.fontSize, lineHeight: 1.1, color: T.ink }}
      >
        <Lines lines={name.lines} />
      </div>
      <div style={{ position: "absolute", left: L.barX - L.marginX, top: (L.rowH - L.barH) / 2, width: w, height: L.barH, borderRadius: 10, background: entity.color }} />
      </div>
      <div
        data-value=""
        style={{ position: "absolute", left: label.left, top: (L.rowH - 44) / 2, width: label.width, height: 44, display: "flex", alignItems: "center", justifyContent: label.plate ? "flex-end" : "flex-start", fontFamily: T.fonts.data, fontWeight: 700, fontSize: 30, color: T.ink, whiteSpace: "nowrap", background: label.plate ? T.surface : undefined, borderRadius: 8, ...TNUM }}
      >
        {text}
        {row.chip ? <RankChip chip={row.chip} /> : null}
      </div>
    </div>
  );
}

/** One event card. Static content; the stack positions and reveals it. Height follows the measured text (`cardLayout`). */
export function EventCard({ event, entity }: { event: Event; entity: Entity | undefined }): ReactElement {
  const lay = cardLayout(event);
  return (
    <div
      data-card={event.id}
      style={{ position: "relative", width: L.cardW, height: lay.height, boxSizing: "border-box", borderRadius: 18, background: T.surface, boxShadow: `inset 0 0 0 2px ${T.grid}, 0 18px 40px rgba(0,0,0,0.28)`, padding: "22px 28px 20px 44px", overflow: "hidden" }}
    >
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 14, background: entity?.color ?? T.accent }} />
      <div style={{ fontFamily: T.fonts.data, fontWeight: 700, fontSize: 28, letterSpacing: 2, color: T.inkDim, lineHeight: "34px", ...TNUM }}>{event.date_label}</div>
      <div data-card-title="" style={{ fontFamily: T.fonts.display, fontWeight: 700, fontSize: lay.title.fontSize, lineHeight: "54px", color: T.ink, marginTop: 6, whiteSpace: "nowrap", height: 54, display: "flex", alignItems: "center" }}>
        {lay.title.lines.join(" ")}
      </div>
      <div style={{ marginTop: 8 }}>
        {event.facts.map((f, i) => (
          <div key={f.ref} data-fact="" style={{ fontFamily: T.fonts.ui, fontWeight: 500, fontSize: 28, lineHeight: "34px", color: T.inkDim, ...TNUM }}>
            <Lines lines={lay.facts[i]?.lines ?? [f.text]} />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Event-card stack (port of the box prototype EventStack, reduced to ONE transition: a side
 * reveal). Side = card index % 2 (left, right, left, ...): the card slides in from that screen
 * edge behind a clip mask. A newer card pushes older ones back per depth (x +24, y -62, scale -6 %,
 * brightness -12 %), at most 3 deep; cards fade out at the end of their life. Positions come from
 * `dataRaceState`, which owns the depth maths.
 */
export function EventStack({ cards, props }: { cards: CardState[]; props: DataRaceProps }): ReactElement {
  const events = new Map(props.events.map((e) => [e.id, e]));
  const entities = new Map(props.entities.map((e) => [e.id, e]));
  return (
    <>
      {cards.map((c) => {
        const event = events.get(c.id);
        if (!event) return null;
        const a = c.enter;
        // side reveal: slide in from the edge while a mask opens from that edge
        const slide = (1 - a) * 300 * (c.side === "left" ? -1 : 1);
        const reveal = (1 - a) * 100;
        const clip = c.side === "left" ? `inset(0 ${reveal.toFixed(2)}% 0 0 round 18px)` : `inset(0 0 0 ${reveal.toFixed(2)}% round 18px)`;
        return (
          <div
            key={c.id}
            data-card-side={c.side}
            data-card-depth={c.depth.toFixed(2)}
            style={{ position: "absolute", left: L.cardX, top: L.cardTop, width: L.cardW, zIndex: 100 + c.index, transform: `translate(${c.offsetX}px, ${c.offsetY}px) scale(${c.scale})`, transformOrigin: "0% 0%" }}
          >
            <div style={{ transform: `translateX(${slide.toFixed(2)}px)`, opacity: c.opacity, clipPath: clip, filter: `brightness(${c.brightness.toFixed(3)})` }}>
              <EventCard event={event} entity={event.entity_id ? entities.get(event.entity_id) : undefined} />
            </div>
          </div>
        );
      })}
    </>
  );
}
