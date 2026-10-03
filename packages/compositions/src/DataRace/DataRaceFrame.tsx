/**
 * DataRaceFrame: one frame of the DataRace composition as a pure function of (props, frame).
 * Renders with plain markup (no hooks, no CSS transitions), so tests can hash any frame with
 * `renderToStaticMarkup` and the Remotion wrapper only supplies `useCurrentFrame()`.
 */
import { videoTheme } from "@statreel/design-tokens";
import { DATA_RACE_LIMITS } from "@statreel/schemas";
import type { ReactElement } from "react";
import { LikeSubscribe, PoweredBy, WinnerSpotlight } from "./ending";
import { AxisTicks, BarRow, EventStack, L, LogoTile, TNUM } from "./parts";
import { type DataRaceRenderProps, dataRaceState } from "./state";

const T = videoTheme;

/** One-line title size: fits 984 px at <= 42 characters, never below 40 px. */
export const titleFontSize = (title: string): number =>
  Math.max(40, Math.min(64, Math.floor(960 / (Math.max(1, title.length) * 0.46))));

export function DataRaceFrame({ props, frame }: { props: DataRaceRenderProps; frame: number }): ReactElement {
  const st = dataRaceState(props, frame);
  const plan = props.timing_plan;
  const byId = new Map(props.entities.map((e) => [e.id, e]));
  const final = plan.orders[plan.orders.length - 1] ?? props.entities.map((e) => e.id);
  // the mark's four bars are the final top-4 colours (the leader is the tallest bar)
  const top = [0, 1, 2, 3].map((i) => byId.get(final[i % Math.max(1, final.length)] as string)?.color ?? T.accent);
  const bars = [top[3], top[2], top[1], top[0]] as [string, string, string, string];
  const inTimeline = st.phase === "timeline";
  const sample = props.data_provenance === "sample";
  const hookTiles = [...props.entities].sort((a, b) => a.name.localeCompare(b.name));
  const showFooter = st.phase !== "powered";

  return (
    <div data-data-race="" data-phase={st.phase} style={{ position: "relative", width: L.width, height: L.height, background: T.background, overflow: "hidden", color: T.ink }}>
      {inTimeline ? (
        <>
          <div data-title="" style={{ position: "absolute", left: L.marginX, top: L.titleY, width: L.width - 2 * L.marginX, height: 76, display: "flex", alignItems: "center", fontFamily: T.fonts.display, fontWeight: 800, fontSize: titleFontSize(props.title), color: T.ink, whiteSpace: "nowrap", overflow: "hidden" }}>
            {props.title}
          </div>
          <div style={{ opacity: st.chartOpacity }}>
            <div style={{ position: "absolute", left: L.marginX, top: L.unitRowY, width: 520, height: 64, display: "flex", alignItems: "center", fontFamily: T.fonts.ui, fontWeight: 600, fontSize: 32, color: T.inkDim }}>
              {props.unit_label}
            </div>
            <div data-clock="" style={{ position: "absolute", right: 120, top: L.unitRowY, height: 64, display: "flex", alignItems: "center", fontFamily: T.fonts.data, fontWeight: 700, fontSize: 52, color: T.ink, ...TNUM }}>
              {props.periods[st.period]}
            </div>
            {plan.strategy.order_label ? (
              <div style={{ position: "absolute", left: L.marginX, top: L.orderLabelY, height: 36, display: "flex", alignItems: "center", fontFamily: T.fonts.data, fontWeight: 500, fontSize: 28, letterSpacing: 2, color: T.inkFaint }}>
                {plan.strategy.order_label}
              </div>
            ) : null}
            <AxisTicks axisMax={st.axisMax} rows={props.entities.length} format={props.value_format} />
            <div style={{ position: "absolute", left: L.barX - 2, top: L.barsTop, width: 3, height: L.rowH * props.entities.length, background: T.grid }} />
            {st.rows.map((row) => {
              const entity = byId.get(row.id);
              return entity ? <BarRow key={row.id} entity={entity} row={row} axisMax={st.axisMax} format={props.value_format} /> : null;
            })}
            <EventStack cards={st.cards} props={props} />
          </div>
          {st.hookOpacity > 0 ? (
            <div data-hook="" style={{ position: "absolute", left: 0, top: 0, width: L.width, height: L.height, opacity: st.hookOpacity }}>
              <div style={{ position: "absolute", left: L.marginX, top: 400, width: L.width - 2 * L.marginX, textAlign: "center", fontFamily: T.fonts.display, fontWeight: 800, fontSize: 96, lineHeight: 1.08, color: T.ink }}>
                {props.hook}
              </div>
              <div style={{ position: "absolute", left: L.marginX, top: 860, width: L.width - 2 * L.marginX, display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 24 }}>
                {hookTiles.map((e) => (
                  <div key={e.id} style={{ width: 164, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                    <LogoTile entity={e} size={124} radius={26} />
                    <div style={{ fontFamily: T.fonts.display, fontWeight: 700, fontSize: 32, color: T.ink, whiteSpace: "nowrap" }}>{e.name}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : null}
      {st.phase === "spotlight" ? (
        <>
          <div style={{ opacity: st.chartOpacity }}>
            {st.rows.map((row) => {
              const entity = byId.get(row.id);
              return entity ? <BarRow key={row.id} entity={entity} row={row} axisMax={st.axisMax} format={props.value_format} /> : null;
            })}
          </div>
          <WinnerSpotlight props={props} winnerId={st.winnerId} f={st.phaseFrame} />
        </>
      ) : null}
      {st.phase === "like" ? <LikeSubscribe f={st.phaseFrame} /> : null}
      {st.phase === "powered" ? <PoweredBy f={st.phaseFrame} bars={bars} /> : null}
      {showFooter ? (
        <div data-source="" style={{ position: "absolute", left: L.marginX, top: L.footerY, width: L.width - 2 * L.marginX - 60, height: 34, display: "flex", alignItems: "center", fontFamily: T.fonts.ui, fontWeight: 500, fontSize: 28, color: T.inkDim, whiteSpace: "nowrap", overflow: "hidden" }}>
          {props.source_line}
        </div>
      ) : null}
      {sample ? (
        <div data-sample-badge="" style={{ position: "absolute", left: 0, top: L.badgeY, width: L.width, display: "flex", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: T.ink, color: T.background, fontFamily: T.fonts.data, fontWeight: 800, fontSize: 28, letterSpacing: 1, padding: "4px 22px", borderRadius: 8, lineHeight: "34px" }}>
            {DATA_RACE_LIMITS.sampleBadgeText}
          </div>
        </div>
      ) : null}
    </div>
  );
}

