/**
 * Undo for the Board (SPEC D.1): a rejected design, case or style leaves its list at once; the
 * toast offers "Undo" for the latest of the last UNDO_CAP decisions (with a count), which sends
 * DELETE /api/.../decision (back to pending). Z or Ctrl/Cmd+Z does the same from the keyboard.
 * The stack itself is undo-store.ts; this file is its one React host:
 *  - ONE host per page (BoardPage), so one live region and one shortcut listener;
 *  - the live region is mounted empty and only its text changes (a region that mounts with its
 *    text announces nothing on most readers);
 *  - an accept entry carries its outcome (outcome.ts): a data-blocked one links to Sources, and an undo the
 *    server refuses (409, its job still runs) offers that job's Cancel (JobBadge) and retries on the next Z;
 *  - the shortcut is off while an overlay owns the keyboard (keys.ts: log drawer, non-lightbox dialogs);
 *  - while a modal <dialog> is open the page behind is inert, so the host renders inside that
 *    dialog (top layer) to stay reachable and audible.
 */
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { qk, serverError } from "../api";
import { CancelJobButton } from "./JobBadge";
import { keysSuppressed } from "./keys";
import { CANCEL_FIRST, isRunningConflict } from "./outcome";
import { createUndoStore, UNDO_CAP, UNDO_MS } from "./undo-store";
import "./undo.css";

export { UNDO_CAP, UNDO_MS };

const store = createUndoStore({
  describeError: serverError,
  isConflict: isRunningConflict,
  conflictNotice: CANCEL_FIRST,
});

export const showUndo = store.show;
export const dismissUndo = store.reset;
export const forgetUndo = store.forget;

/** The open modal dialog (innermost last), else the page body: where the host has to live to stay reachable. */
function topLayerHost(): HTMLElement {
  const open = document.querySelectorAll<HTMLElement>("dialog[open]");
  return open[open.length - 1] ?? document.body;
}

function useTopLayerHost(): HTMLElement {
  const [host, setHost] = useState<HTMLElement>(topLayerHost);
  useEffect(() => {
    const check = () => setHost((h) => (h === topLayerHost() ? h : topLayerHost()));
    check();
    const mo = new MutationObserver(check);
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
    return () => mo.disconnect();
  }, []);
  return host;
}

/** Renders the undo toast and the page's live region. Mount exactly once per Board page. */
export function UndoToastHost() {
  const s = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const qc = useQueryClient();
  const host = useTopLayerHost();
  const undo = useCallback(
    () =>
      void store.undoLatest(() => {
        void qc.invalidateQueries({ queryKey: qk.board });
        void qc.invalidateQueries({ queryKey: qk.styles });
        void qc.invalidateQueries({ queryKey: qk.cases });
      }),
    [qc],
  );

  // leaving the page drops the stack
  useEffect(() => dismissUndo, []);

  // Z / Ctrl+Z / Cmd+Z undo the latest decision, unless the owner is typing (native text undo wins) or an overlay is open
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "z" || e.altKey || e.shiftKey || e.repeat || keysSuppressed(e.target)) return;
      if (e.ctrlKey && e.metaKey) return;
      if (!store.getState().stack.length) return;
      e.preventDefault();
      undo();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [undo]);

  const n = s.stack.length;
  const top = s.stack[n - 1];
  return createPortal(
    <>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="undo-live">
        {s.said}
      </div>
      {top ? (
        <div className="bd-toast" data-testid="undo-toast" data-count={n}>
          <span className="bd-toast__msg">
            {top.message}
            {s.notice ? (
              <span className="bd-toast__err" data-testid="undo-toast-error">
                {s.notice}
              </span>
            ) : null}
          </span>
          {top.blocked ? (
            <Link to="/sources" className="bd-link" data-testid="undo-toast-sources">
              Sources
            </Link>
          ) : null}
          {s.cancelJobId ? (
            <CancelJobButton jobId={s.cancelJobId} title={top.message} testId="undo-toast-cancel" />
          ) : null}
          <button
            type="button"
            className="btn btn--sm"
            data-testid="undo-toast-undo"
            aria-keyshortcuts="Z Control+Z Meta+Z"
            aria-disabled={s.busy || undefined}
            onClick={() => {
              if (!s.busy) undo();
            }}
          >
            {n > 1 ? `Undo (${n})` : "Undo"} <kbd>Z</kbd>
          </button>
        </div>
      ) : null}
    </>,
    host,
  );
}
