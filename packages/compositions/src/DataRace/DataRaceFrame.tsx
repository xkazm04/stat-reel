/**
 * DataRaceFrame: one frame of the DataRace composition as a pure function of (props, frame).
 * Renders with plain markup (no hooks, no CSS transitions), so tests can hash any frame with
 * `renderToStaticMarkup` and the Remotion wrapper only supplies `useCurrentFrame()`.
 */
import { videoTheme } from "@statreel/design-tokens";
import { DATA_RACE_LIMITS } from "@statreel/schemas";
import type { ReactElement } from "react";
import { LikeSubscribe, PoweredBy, WinnerSpotlight, spotlightDim, spotlightScale } from "./ending";
import { FOOTER_W as footerW, HOOK_TILE_W, clockLayout, footerLayout, hookLayout, hookTileNameLayout, titleLayout, unitLayout } from "./layout";
import { AxisTicks, BarRow, EventStack, L, Lines, LogoTile, TNUM } from "./parts";
import { type DataRaceRenderProps, dataRaceState } from "./state";

const T = videoTheme;

/** One-line title size: the largest 64 -> 28 px that fits 960 px by the measured advances of Barlow 800. */
export const titleFontSize = (title: string): number => titleLayout(title).fontSize;

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
  const footer = footerLayout(props.source_line);
  const clock = clockLayout(props.periods);
  const unit = unitLayout(props.unit_label, clock.width);
  const hook = hookLayout(props.hook);

  return (
    <div data-data-race="" data-phase={st.phase} style={{ position: "relative", width: L.width, height: L.height, background: st.farPlane, overflow: "hidden", color: T.ink }}>
      {inTimeline ? (
        <>
          <div data-title="" style={{ position: "absolute", left: L.marginX, top: L.titleY, width: L.width - 2 * L.marginX, height: 76, display: "flex", alignItems: "center", fontFamily: T.fonts.display, fontWeight: 800, fontSize: titleLayout(props.title).fontSize, color: T.ink, whiteSpace: "nowrap", overflow: "hidden" }}>
            {props.title}
          </div>
          <div style={{ opacity: st.chartOpacity }}>
            <div data-unit="" style={{ position: "absolute", left: L.marginX, top: L.unitRowY, width: unit.width, height: 64, display: "flex", flexDirection: "column", justifyContent: "center", fontFamily: T.fonts.ui, fontWeight: 600, fontSize: unit.fontSize, lineHeight: 1.1, color: T.inkDim }}>
              <Lines lines={unit.lines} />
            </div>
            <div data-clock="" data-clock-rolling={st.clock.rolling ? "1" : "0"} style={{ position: "absolute", right: 120, top: L.unitRowY, width: clock.width, height: 64, overflow: "hidden", fontFamily: T.fonts.data, fontWeight: 700, fontSize: clock.fontSize, color: T.ink, whiteSpace: "nowrap", ...TNUM }}>
              {st.clock.rolling ? (
                <>
                  <div data-clock-out="" style={{ position: "absolute", right: 0, top: 0, height: 64, display: "flex", alignItems: "center", opacity: (1 - st.clock.u).toFixed(3), transform: `translateY(${(-st.clock.u * 40).toFixed(2)}px)` }}>
                    {st.clock.from}
                  </div>
                  <div data-clock-in="" style={{ position: "absolute", right: 0, top: 0, height: 64, display: "flex", alignItems: "center", opacity: st.clock.u.toFixed(3), transform: `translateY(${((1 - st.clock.u) * 40).toFixed(2)}px)` }}>
                    {st.clock.to}
                  </div>
                </>
              ) : (
                <div style={{ position: "absolute", right: 0, top: 0, height: 64, display: "flex", alignItems: "center" }}>{st.clock.to}</div>
              )}
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
              <div data-hook-text="" style={{ position: "absolute", left: L.marginX, top: 400, width: L.width - 2 * L.marginX, textAlign: "center", fontFamily: T.fonts.display, fontWeight: 800, fontSize: hook.fontSize, lineHeight: 1.08, color: T.ink }}>
                <Lines lines={hook.lines} />
              </div>
              <div style={{ position: "absolute", left: L.marginX, top: 860, width: L.width - 2 * L.marginX, display: "flex", flexWrap: "wrap", justifyContent: "center", alignItems: "flex-start", columnGap: 12, rowGap: 24 }}>
                {hookTiles.map((e) => {
                  const nm = hookTileNameLayout(e.name);
                  return (
                    <div key={e.id} data-hook-tile="" style={{ width: HOOK_TILE_W, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                      <LogoTile entity={e} size={124} radius={26} />
                      <div style={{ fontFamily: T.fonts.display, fontWeight: 700, fontSize: nm.fontSize, lineHeight: 1.1, color: T.ink, textAlign: "center" }}>
                        <Lines lines={nm.lines} />
                      </div>
                    </div>
                  );
                })}
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
              const win = row.id === st.winnerId;
              return entity ? (
                <BarRow key={row.id} entity={entity} row={row} axisMax={st.axisMax} format={props.value_format} dim={win ? 1 : spotlightDim(st.phaseFrame)} scale={win ? spotlightScale(st.phaseFrame) : 1} />
              ) : null;
            })}
          </div>
          <WinnerSpotlight props={props} winnerId={st.winnerId} f={st.phaseFrame} />
        </>
      ) : null}
      {st.phase === "like" ? <LikeSubscribe f={st.phaseFrame} /> : null}
      {st.phase === "powered" ? <PoweredBy f={st.phaseFrame} bars={bars} /> : null}
      {showFooter ? (
        <div data-source="" style={{ position: "absolute", left: L.marginX, top: footer.top, width: footerW, height: footer.height, display: "flex", flexDirection: "column", justifyContent: "flex-end", fontFamily: T.fonts.ui, fontWeight: 500, fontSize: 28, lineHeight: "32px", color: T.inkDim }}>
          <Lines lines={footer.lines} />
        </div>
      ) : null}
      {sample ? (
        <div data-sample-badge="" style={{ position: "absolute", left: 0, top: footer.badgeY, width: L.width, display: "flex", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: T.ink, color: T.background, fontFamily: T.fonts.data, fontWeight: 800, fontSize: 28, letterSpacing: 1, padding: "4px 22px", borderRadius: 8, lineHeight: "34px" }}>
            {DATA_RACE_LIMITS.sampleBadgeText}
          </div>
        </div>
      ) : null}
    </div>
  );
}

