import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Band, Card, CardGrid } from "./Card";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe("Card", () => {
  it("a top-level card is a raised paper section with a labelled h2 header", () => {
    const out = html(h(Card, { title: "Channels", tag: 3, actions: h("a", { href: "/x" }, "all") }, "body"));
    expect(out).toContain('data-tone="paper"');
    expect(out).toContain('data-elev="1"');
    expect(out).toMatch(/<h2 class="card__title" id="([^"]+)">Channels<\/h2>/);
    const id = out.match(/<h2 class="card__title" id="([^"]+)"/)?.[1];
    expect(out).toContain(`aria-labelledby="${id}"`);
    expect(out).toContain('<span class="card__tag">3</span>');
    expect(out).toContain('<div class="card__actions"><a href="/x">all</a></div>');
    expect(out).toContain('<div class="card__body">body</div>');
  });

  it("a card inside a card is a flat recessed well with an h3 title", () => {
    const out = html(h(Card, { title: "Outer" }, h(Card, { title: "Inner" }, "x")));
    const inner = out.split("<section")[2] ?? "";
    expect(out).toContain('data-tone="paper"');
    expect(inner).toContain('data-tone="well"');
    expect(inner).toContain('data-elev="0"');
    expect(out).toMatch(/<h3 class="card__title"[^>]*>Inner<\/h3>/);
  });

  it("explicit tone, elevation, pad and heading level win over the nesting defaults", () => {
    const out = html(h(Card, { tone: "signal", elevation: 2, pad: "none", level: 4, title: "t" }, "x"));
    expect(out).toContain('data-tone="signal"');
    expect(out).toContain('data-elev="2"');
    expect(out).toContain('data-pad="none"');
    expect(out).toContain("<h4 ");
  });

  it("accent and scroll become CSS variables and data flags", () => {
    const out = html(h(Card, { accent: "var(--ident-x)", scroll: 320, stickyHead: true, title: "t" }, "x"));
    expect(out).toContain("--card-accent:var(--ident-x)");
    expect(out).toContain("data-accent");
    expect(out).toContain("--card-max:320px");
    expect(out).toContain('data-scroll="max"');
    expect(out).toContain("data-sticky");
    expect(html(h(Card, { scroll: true }, "x"))).toContain('data-scroll="fill"');
  });

  it("a headerless card renders no header and no aria-labelledby; a footer renders", () => {
    const out = html(h(Card, { footer: "keys" }, "x"));
    expect(out).not.toContain("card__head");
    expect(out).not.toContain("aria-labelledby");
    expect(out).toContain('<footer class="card__foot">keys</footer>');
  });

  it("titleId and titleTabIndex give the heading a stable focus target; element and test id pass through", () => {
    const out = html(
      h(Card, {
        as: "li",
        title: "Every slot",
        titleId: "h-slots",
        titleTabIndex: -1,
        testId: "slots",
        className: "cal-slots",
      }),
    );
    expect(out).toMatch(/^<li /);
    expect(out).toContain('id="h-slots"');
    expect(out).toContain('tabindex="-1"');
    expect(out).toContain('aria-labelledby="h-slots"');
    expect(out).toContain('data-testid="slots"');
    expect(out).toContain('class="card cal-slots"');
  });

  it("busy dims the body through aria-busy", () => {
    expect(html(h(Card, { busy: true }, "x"))).toContain('aria-busy="true"');
    expect(html(h(Card, {}, "x"))).not.toContain("aria-busy");
  });
});

describe("CardGrid and Band", () => {
  it("CardGrid sets the minimum column width, an optional fixed count and the gap", () => {
    const out = html(h(CardGrid, { min: 240, cols: 2, gap: "lg" }, "x"));
    expect(out).toContain("--card-min:240px");
    expect(out).toContain('data-cols="2"');
    expect(out).toContain('data-gap="lg"');
    expect(html(h(CardGrid, { as: "ul" }, "x"))).toMatch(/^<ul /);
  });

  it("Band names its section with number, title and lede", () => {
    const out = html(h(Band, { num: "02", title: "Presets", lede: "Ten formats" }, h(Card, { title: "c" })));
    expect(out).toContain('<span class="band__num">02</span>');
    expect(out).toContain('<p class="band__lede">Ten formats</p>');
    const id = out.match(/<h2 class="band__title" id="([^"]+)"/)?.[1];
    expect(out).toContain(`aria-labelledby="${id}"`);
  });
});
