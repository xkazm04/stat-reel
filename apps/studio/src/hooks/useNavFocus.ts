/**
 * Title + focus on navigation (app-shell: a route change must be announced). After a navigation
 * that changed the PATH (not a search tweak such as a filter), the page's `#main` landmark takes
 * focus, so keyboard and screen-reader owners start at the new screen instead of on the link they
 * clicked. Pages already write `<main id="main">`; this makes it focusable (tabindex -1) on demand
 * rather than editing every page. The initial load is skipped (the browser owns it). The skip link
 * uses `focusMain` too, so it works without a hash in the URL.
 */
import { useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { useProject } from "../data";
import { studioProjectId, titleFor } from "../titles";

/** Focus the page's main landmark; false when it is not on screen yet (or is still the pending skeleton). */
export function focusMain(): boolean {
  const main = document.getElementById("main");
  if (!main || main.getAttribute("aria-busy") === "true") return false;
  if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
  main.focus({ preventScroll: true });
  return true;
}

/** Wait (frame by frame, bounded) for the lazy screen to mount, then focus it. Returns a cancel. */
function focusMainSoon(maxFrames = 120): () => void {
  let raf = 0;
  let n = 0;
  const tick = () => {
    // the owner already put focus inside the new page (autofocus, a typed key): leave it
    const a = document.activeElement;
    const main = document.getElementById("main");
    if (a && a !== document.body && main?.contains(a)) return;
    if (focusMain() || ++n >= maxFrames) return;
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

export function useNavFocus(): void {
  const router = useRouter();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const view = useRouterState({ select: (s) => (s.location.search as { view?: string }).view ?? null });
  const projectId = studioProjectId(path);
  // same cache entry the studio screen reads (the route loader warms it), so no extra request
  const project = useProject(projectId);
  const projectTitle = project.data?.project.title ?? null;

  useEffect(() => {
    document.title = titleFor(path, { projectTitle, view });
  }, [path, view, projectTitle]);

  useEffect(() => {
    let cancel: (() => void) | null = null;
    const off = router.subscribe("onResolved", (e) => {
      if (!e.pathChanged || !e.fromLocation) return;
      cancel?.();
      cancel = focusMainSoon();
    });
    return () => {
      off();
      cancel?.();
    };
  }, [router]);
}
