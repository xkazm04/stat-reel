import { describe, expect, it } from "vitest";
import { type InertNode, type InertParent, inertOutside } from "./inertBackground";

const node = (parent: InertParent | null): InertNode & { children: InertNode[] } => {
  const n = { inert: false, parentElement: parent, children: [] as InertNode[] };
  if (parent) (parent.children as InertNode[]).push(n);
  return n;
};

describe("inertOutside", () => {
  it("inerts siblings up the tree, spares the modal's branch, and restores prior values", () => {
    const body = node(null);
    const nav = node(body);
    const main = node(body);
    const content = node(main);
    const footer = node(main);
    const modal = node(main);
    footer.inert = true; // was already inert: must stay so after restore
    const restore = inertOutside(modal);
    expect([nav.inert, content.inert, footer.inert]).toEqual([true, true, true]);
    expect([body.inert, main.inert, modal.inert]).toEqual([false, false, false]);
    restore();
    expect([nav.inert, content.inert, footer.inert, main.inert]).toEqual([false, false, true, false]);
  });
});
