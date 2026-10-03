/**
 * Undo toast for the Board (SPEC D.1): a rejected design, case or style leaves its list at once; a
 * 6 s toast offers "Undo", which sends DELETE /api/.../decision (back to pending). A tiny external
 * store, so any gate (deep in a lightbox or a dialog) can raise it and one host renders it.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import { qk, serverError } from "../api";
import "./undo.css";

export const UNDO_MS = 6000;
export type UndoToast = { id: number; message: string; undo: () => Promise<unknown> };

let current: UndoToast | null = null;
let seq = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

export function showUndo(message: string, undo: () => Promise<unknown>): void {
  clearTimeout(timer);
  current = { id: ++seq, message, undo };
  timer = setTimeout(dismissUndo, UNDO_MS);
  emit();
}

export function dismissUndo(): void {
  clearTimeout(timer);
  current = null;
  emit();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => current;

/** Renders the active toast. Mount once per Board page. */
export function UndoToastHost() {
  const t = useSyncExternalStore(subscribe, snapshot, snapshot);
  const qc = useQueryClient();
  // leaving the page drops the toast
  useEffect(() => dismissUndo, []);
  if (!t) return null;
  return (
    <div className="bd-toast" role="status" aria-live="polite" data-testid="undo-toast" key={t.id}>
      <span>{t.message}</span>
      <button
        type="button"
        className="btn btn--sm"
        data-testid="undo-toast-undo"
        onClick={() => {
          dismissUndo();
          t.undo()
            .catch((e: unknown) => showUndo(`Could not undo: ${serverError(e)}`, async () => {}))
            .finally(() => {
              void qc.invalidateQueries({ queryKey: qk.board });
              void qc.invalidateQueries({ queryKey: qk.styles });
              void qc.invalidateQueries({ queryKey: qk.cases });
            });
        }}
      >
        Undo
      </button>
    </div>
  );
}
