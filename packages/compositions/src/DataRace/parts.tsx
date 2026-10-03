/**
 * Visual parts of DataRace: logo tile, bar rows, event card, event stack. Everything reads colours
 * from `videoTheme` (design-tokens) by name; entity colours come from props. Every readable text is
 * >= 28 px at 1080 wide, numbers use tabular figures.
 */
import { videoTheme } from "@statreel/design-tokens";
import type { DataRaceProps } from "@statreel/schemas";
import type { CSSProperties, ReactElement } from "react";
import { type CardState, type RaceRow, niceTicks } from "./state";

type Entity = DataRaceProps["entities"][number];
type Event = DataRaceProps["events"][number];
type ValueFormat = DataRaceProps["value_format"];

/** All geometry for the 1080 x 1920 vertical frame. Safe box: y 150-1580, nothing right of x ~965. */
export const L = {
  width: 1080,
  height: 1920,
  marginX: 60,
  titleY: 150,
  unitRowY: 236,
  orderLabelY: 304,
  barsTop: 352,
  rowH: 74,
  barH: 52,
  tile: 60,
  nameX: 132,
  nameW: 200,
  barX: 344,
  barMaxW: 480,
  cardX: 60,
  cardW: 840,
  cardH: 236,
  cardTop: 1250,
  badgeY: 1500,
  footerY: 1544,
} as const;

export const TNUM: CSSProperties = { fontVariantNumeric: "tabular-nums", fontFeatureSettings: '"tnum" 1' };
const T = videoTheme;

/** Black or white ink, whichever contrasts more with `hex`. */
export function onColor(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return lum > 0.35 ? "#12161a" : "#ffffff";
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
        <img alt="" src={entity.logo.src} style={{ width: "74%", height: "74%", objectFit: "contain" }} />
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

/** Right edge of anything the end of a bar draws: the platform icon column starts at ~x 965. */
export const LABEL_RIGHT = 965;
/** Bold 30 px tabular glyphs are at most ~0.62 em wide; a deliberately pessimistic estimate. */
export const textWidth = (text: string, size: number): number => Math.ceil(text.length * size * 0.62);

/**
 * Where the value label sits, relative to the row (row x = marginX). It follows the bar end, but a
 * long prefix/suffix or a bar near full width would cross x 965, so it is shifted left to stay
 * inside and gets a plate so it stays readable where it overlaps the bar tip.
 */
export function valueLabelLayout(barW: number, text: string, size = 30): { left: number; width: number; plate: boolean } {
  const width = textWidth(text, size);
  const natural = L.barX - L.marginX + barW + 14;
  const max = LABEL_RIGHT - L.marginX - width;
  return natural <= max ? { left: natural, width, plate: false } : { left: max, width, plate: true };
}

/** Gridlines and their labels, behind the rows. Values come from `niceTicks` (grow-free: the axis is fixed). */
export function AxisTicks({ axisMax, rows, format }: { axisMax: number; rows: number; format: ValueFormat | undefined }): ReactElement {
  const ticks = niceTicks(axisMax);
  const step = ticks[0] ?? 1;
  const decimals = Math.max(0, Math.min(3, -Math.floor(Math.log10(step) + 1e-9)));
  const bottom = L.barsTop + L.rowH * rows;
  return (
    <>
      {ticks.map((v) => {
        const x = L.barX + (v / axisMax) * L.barMaxW;
        const label = formatValue(v, { prefix: "", suffix: "", ...format, decimals });
        const w = textWidth(label, 28);
        const left = Math.min(x - w / 2, LABEL_RIGHT - w);
        return (
          <div key={v} data-tick={v}>
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

export function nameFontSize(name: string, width: number): number {
  return Math.max(28, Math.min(36, Math.floor(width / (Math.max(1, name.length) * 0.46))));
}

export function BarRow({ entity, row, axisMax, format }: { entity: Entity; row: RaceRow; axisMax: number; format: ValueFormat | undefined }): ReactElement | null {
  if (row.presence <= 0.001) return null;
  const w = Math.max(6, Math.min(1, row.value / axisMax) * L.barMaxW);
  const top = L.barsTop + row.pos * L.rowH;
  const text = formatValue(row.value, format);
  const label = valueLabelLayout(w, text);
  return (
    <div data-row={entity.id} style={{ position: "absolute", left: L.marginX, top, width: L.width - 2 * L.marginX, height: L.rowH, opacity: row.presence }}>
      <div style={{ position: "absolute", left: 0, top: (L.rowH - L.tile) / 2 }}>
        <LogoTile entity={entity} size={L.tile} />
      </div>
      <div
        style={{ position: "absolute", left: L.nameX - L.marginX, top: 0, width: L.nameW, height: L.rowH, display: "flex", alignItems: "center", fontFamily: T.fonts.display, fontWeight: 700, fontSize: nameFontSize(entity.name, L.nameW), color: T.ink, whiteSpace: "nowrap", overflow: "hidden" }}
      >
        {entity.name}
      </div>
      <div style={{ position: "absolute", left: L.barX - L.marginX, top: (L.rowH - L.barH) / 2, width: w, height: L.barH, borderRadius: 10, background: entity.color }} />
      <div
        data-value=""
        style={{ position: "absolute", left: label.left, top: (L.rowH - 44) / 2, width: label.width, height: 44, display: "flex", alignItems: "center", justifyContent: label.plate ? "flex-end" : "flex-start", fontFamily: T.fonts.data, fontWeight: 700, fontSize: 30, color: T.ink, whiteSpace: "nowrap", background: label.plate ? T.surface : undefined, borderRadius: 8, ...TNUM }}
      >
        {text}
      </div>
    </div>
  );
}

/** One event card. Static content; the stack positions and reveals it. */
export function EventCard({ event, entity }: { event: Event; entity: Entity | undefined }): ReactElement {
  return (
    <div
      data-card={event.id}
      style={{ position: "relative", width: L.cardW, height: L.cardH, boxSizing: "border-box", borderRadius: 18, background: T.surface, boxShadow: `inset 0 0 0 2px ${T.grid}, 0 18px 40px rgba(0,0,0,0.28)`, padding: "22px 28px 20px 44px", overflow: "hidden" }}
    >
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 14, background: entity?.color ?? T.accent }} />
      <div style={{ fontFamily: T.fonts.data, fontWeight: 700, fontSize: 28, letterSpacing: 2, color: T.inkDim, lineHeight: "34px", ...TNUM }}>{event.date_label}</div>
      <div style={{ fontFamily: T.fonts.display, fontWeight: 700, fontSize: 46, lineHeight: "54px", color: T.ink, marginTop: 6, whiteSpace: "nowrap", overflow: "hidden" }}>{event.title}</div>
      <div style={{ marginTop: 8 }}>
        {event.facts.map((f) => (
          <div key={f.ref} style={{ fontFamily: T.fonts.ui, fontWeight: 500, fontSize: 28, lineHeight: "36px", color: T.inkDim, whiteSpace: "nowrap", overflow: "hidden", ...TNUM }}>
            {f.text}
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
