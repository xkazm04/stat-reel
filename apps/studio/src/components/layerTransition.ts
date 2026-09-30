/**
 * A one-shot store for the heatmap's layer choreography: the grid records where the clicked cell
 * sits (viewport rect) before it opens layer 2; the layer reads it once on mount and expands from
 * there. A deep link has no origin and simply appears.
 */
export type Rect = { top: number; left: number; right: number; bottom: number };

let origin: { key: string; rect: Rect } | null = null;

export function setLayerOrigin(key: string, el: Element | null): void {
  if (!el) {
    origin = null;
    return;
  }
  const r = el.getBoundingClientRect();
  origin = { key, rect: { top: r.top, left: r.left, right: r.right, bottom: r.bottom } };
}

/** The origin for `key`, consumed (a second read returns null). */
export function takeLayerOrigin(key: string): Rect | null {
  const o = origin;
  origin = null;
  return o && o.key === key ? o.rect : null;
}

/** The on-screen rect of a grid cell now, or null when it is not in view. */
export function visibleRect(el: Element | null): Rect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.bottom <= 0 || r.top >= window.innerHeight || r.width === 0) return null;
  return { top: r.top, left: r.left, right: r.right, bottom: r.bottom };
}
