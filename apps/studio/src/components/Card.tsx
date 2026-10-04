/**
 * Cards: the shared structure of every screen (the "module" idea of the brand-screens contest,
 * variant A/3, in Photo Finish colours). A screen is a sheet; each section on it is a raised card
 * with a header row (title, tag, actions), a body and an optional footer; a card inside a card is
 * a recessed "well" with no shadow. One component, a handful of parameters, so structure is
 * decided by content and not repainted per page.
 *
 *   <Card title="Channels" tag="3" actions={<Link …/>}>…</Card>
 *   <Card title="Registry" pad="none">{table}</Card>            flush table, scrolls inside
 *   <Card tone="signal" title="Private only">…</Card>           clay-red top edge: a rule or alert
 *   <Card accent={identVar(id)} …>                              coloured top edge (use-case ident)
 *   <CardGrid min={260}><Card/>…</CardGrid>                     responsive columns
 *   <Band num="02" title="Presets" lede="…">cards</Band>        a titled group of cards
 *
 * Props are data only; the look lives in styles/card.css (tokens --card-* in the theme).
 */
import {
  type CSSProperties,
  createContext,
  type ElementType,
  type HTMLAttributes,
  type ReactNode,
  useContext,
  useId,
} from "react";

export type CardTone = "paper" | "well" | "signal";
export type CardPad = "none" | "sm" | "md" | "lg";

const Depth = createContext(0);
/** How many cards enclose the current one (0 = top level). */
export const useCardDepth = (): number => useContext(Depth);

export type CardProps = Omit<HTMLAttributes<HTMLElement>, "title"> & {
  /** element to render (default `section`; use `li` inside a list, `div` for plain blocks) */
  as?: ElementType;
  /** header title; omit it (and `tag`/`actions`) for a headerless card */
  title?: ReactNode;
  /** heading level of the title (default 2; nested cards default to 3) */
  level?: 2 | 3 | 4;
  /** mono note after the title: a count, a state, a date */
  tag?: ReactNode;
  /** right end of the header: links, a segmented control, a button */
  actions?: ReactNode;
  /** bottom strip: totals, hints, the rule that explains the card */
  footer?: ReactNode;
  /** paper = raised white card, well = recessed (default when nested), signal = clay-red top edge */
  tone?: CardTone;
  /** 0 flat, 1 raised, 2 lifted; default 1 at top level and 0 when nested */
  elevation?: 0 | 1 | 2;
  /** body padding; `none` for tables, grids and lists that go edge to edge */
  pad?: CardPad;
  /** a CSS colour painted as a 3 px top edge (use-case ident, status) */
  accent?: string;
  /** body scrolls: `true` fills the card (needs a bounded height), a number is a max-height in px */
  scroll?: boolean | number;
  /** header stays put while the body scrolls */
  stickyHead?: boolean;
  /** busy / refreshing: dims the body and sets aria-busy */
  busy?: boolean;
  testId?: string;
  /** stable id of the title (anchors, focus targets); default is generated */
  titleId?: string;
  /** makes the title a programmatic focus target (-1) */
  titleTabIndex?: number;
};

export function Card({
  as: Tag = "section",
  title,
  level,
  tag,
  actions,
  footer,
  tone,
  elevation,
  pad = "md",
  accent,
  scroll,
  stickyHead,
  busy,
  testId,
  titleId,
  titleTabIndex,
  className = "",
  style,
  children,
  ...rest
}: CardProps) {
  const depth = useContext(Depth);
  const nested = depth > 0;
  const autoId = useId();
  const headId = titleId ?? autoId;
  const hasHead = title !== undefined || tag !== undefined || actions !== undefined;
  const lvl = level ?? (nested ? 3 : 2);
  const H = `h${lvl}` as ElementType;
  const t: CardTone = tone ?? (nested ? "well" : "paper");
  const e = elevation ?? (nested ? 0 : 1);
  const vars: CSSProperties = { ...style };
  if (accent) (vars as Record<string, string>)["--card-accent"] = accent;
  if (typeof scroll === "number") (vars as Record<string, string>)["--card-max"] = `${scroll}px`;
  return (
    <Depth.Provider value={depth + 1}>
      <Tag
        {...rest}
        className={`card ${className}`.trim()}
        style={vars}
        data-tone={t}
        data-elev={e}
        data-pad={pad}
        data-accent={accent ? "" : undefined}
        data-scroll={scroll === undefined || scroll === false ? undefined : scroll === true ? "fill" : "max"}
        data-sticky={stickyHead ? "" : undefined}
        data-testid={testId ?? (rest as Record<string, unknown>)["data-testid"]}
        aria-labelledby={rest["aria-labelledby"] ?? (hasHead && title !== undefined ? headId : undefined)}
        aria-busy={busy || undefined}
      >
        {hasHead ? (
          <header className="card__head">
            {title !== undefined ? (
              <H className="card__title" id={headId} tabIndex={titleTabIndex}>
                {title}
              </H>
            ) : null}
            {tag !== undefined ? <span className="card__tag">{tag}</span> : null}
            {actions !== undefined ? <div className="card__actions">{actions}</div> : null}
          </header>
        ) : null}
        <div className="card__body">{children}</div>
        {footer !== undefined ? <footer className="card__foot">{footer}</footer> : null}
      </Tag>
    </Depth.Provider>
  );
}

/** Responsive columns for cards: as many `min`-px columns as fit, or a fixed count. */
export function CardGrid({
  min = 280,
  cols,
  gap = "md",
  as: Tag = "div",
  className = "",
  style,
  children,
  ...rest
}: HTMLAttributes<HTMLElement> & {
  as?: ElementType;
  min?: number;
  cols?: 1 | 2 | 3 | 4;
  gap?: "sm" | "md" | "lg";
}) {
  const vars = { "--card-min": `${min}px`, ...style } as CSSProperties;
  return (
    <Tag {...rest} className={`card-grid ${className}`.trim()} style={vars} data-cols={cols} data-gap={gap}>
      {children}
    </Tag>
  );
}

/** A titled group of cards (the contest's "band": number, title, one-line lede). */
export function Band({
  num,
  title,
  lede,
  actions,
  as: Tag = "section",
  className = "",
  children,
  ...rest
}: Omit<HTMLAttributes<HTMLElement>, "title"> & {
  as?: ElementType;
  num?: string;
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
}) {
  const id = useId();
  return (
    <Tag {...rest} className={`band ${className}`.trim()} aria-labelledby={id}>
      <header className="band__head">
        {num ? <span className="band__num">{num}</span> : null}
        <h2 className="band__title" id={id}>
          {title}
        </h2>
        {lede ? <p className="band__lede">{lede}</p> : null}
        {actions ? <div className="band__actions">{actions}</div> : null}
      </header>
      {children}
    </Tag>
  );
}
