/**
 * Board (ADR 006): a huge grid of visual-only design outputs and use-case ideas behind the
 * owner's gate (accept / reject style / reject case / reject both). Placeholder while three page
 * variants are prototyped; the Board module is built in this folder next.
 */
import { Link } from "@tanstack/react-router";

export function BoardPage() {
  return (
    <main id="main" className="page board-page">
      <header className="page__head">
        <div>
          <p className="eyebrow">
            <i />
            Board
          </p>
          <h1 className="page__title display">Board — being prototyped</h1>
          <p className="page__sub">
            Design outputs and use-case ideas behind the owner's gate: accept, reject style, reject case, reject both.
          </p>
        </div>
      </header>
      <div className="empty">
        <b>Not built yet</b>
        Three page variants are being prototyped first. Nothing here is a design output or a real result until the
        Board module lands. Meanwhile, pick real work from the <Link to="/heatmap">heatmap</Link>.
      </div>
    </main>
  );
}
