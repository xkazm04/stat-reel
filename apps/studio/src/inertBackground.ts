/**
 * Make everything outside a modal inert (the Front's lane scene is `aria-modal` but its background
 * stayed focusable and clickable). Walks from the modal up to the document root and sets `inert`
 * on each sibling, so only the modal's own branch stays live; the returned function restores each
 * sibling's previous value. Structural types only, so it is unit-tested without a DOM.
 */
/** `inert` is optional because `Element` (the type of `children`) does not declare it; HTMLElement does. */
export type InertNode = { inert?: boolean; parentElement: InertParent | null };
export type InertParent = InertNode & { children: ArrayLike<InertNode> };

export function inertOutside(modal: InertNode, stop: InertNode | null = null): () => void {
  const saved: [InertNode, boolean | undefined][] = [];
  let node: InertNode = modal;
  while (node.parentElement && node !== stop) {
    const parent: InertParent = node.parentElement;
    for (const sib of Array.from(parent.children)) {
      if (sib === node) continue;
      saved.push([sib, sib.inert]);
      sib.inert = true;
    }
    node = parent;
  }
  return () => {
    for (const [n, was] of saved) n.inert = was;
  };
}
