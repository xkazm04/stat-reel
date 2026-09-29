/** Code-based TanStack Router: front panel, heatmap, projects, studio, sources. */
import type { Mode } from "@statreel/schemas";
import { createRootRoute, createRoute, createRouter, Link, Outlet } from "@tanstack/react-router";
import { Rail } from "./components/Rail";
import { HeatmapPage } from "./routes/Heatmap";
import { LandingPage } from "./routes/Landing";
import { ProjectsPage } from "./routes/Projects";
import { SourcesPage } from "./routes/Sources";
import { StudioPage } from "./routes/Studio";

function RootLayout() {
  return (
    <>
      <Rail />
      <Outlet />
    </>
  );
}

function NotFound() {
  return (
    <main id="main" className="page narrow">
      <div className="display empty">
        <b>No such panel.</b> <Link to="/">Back to the front panel</Link>
      </div>
    </main>
  );
}

function RouteError({ error }: { error: unknown }) {
  return (
    <main id="main" className="page narrow">
      <div className="state state-error" role="alert">
        <span className="led st-blocked">
          <span className="led-label">PANEL FAULT</span>
        </span>
        <div>
          <b>This panel crashed.</b>{" "}
          <span className="mono">{error instanceof Error ? error.message : String(error)}</span>
          <p className="state-hint">
            <Link to="/">Back to the front panel</Link>
          </p>
        </div>
      </div>
    </main>
  );
}

const rootRoute = createRootRoute({ component: RootLayout, notFoundComponent: NotFound, errorComponent: RouteError });

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: LandingPage });

export type HeatmapSearch = { mode?: Mode; cell?: string };
const heatmapRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/heatmap",
  validateSearch: (s: Record<string, unknown>): HeatmapSearch => ({
    mode: s.mode === "non_commercial" ? "non_commercial" : s.mode === "monetized" ? "monetized" : undefined,
    cell: typeof s.cell === "string" ? s.cell : undefined,
  }),
  component: HeatmapPage,
});

const projectsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/projects", component: ProjectsPage });

export const studioRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/studio/$projectId",
  component: StudioPage,
});

const sourcesRoute = createRoute({ getParentRoute: () => rootRoute, path: "/sources", component: SourcesPage });

const routeTree = rootRoute.addChildren([indexRoute, heatmapRoute, projectsRoute, studioRoute, sourcesRoute]);

export const router = createRouter({ routeTree, defaultPreload: "intent", scrollRestoration: true });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
