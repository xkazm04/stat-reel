/** Code-based TanStack Router: front, heatmap, rundown, studio (control room / render & gate / publish), metrics, sources. */
import type { Mode, Sport } from "@statreel/schemas";
import { createRootRoute, createRoute, createRouter, Link, Outlet } from "@tanstack/react-router";
import { Nav } from "./components/Nav";
import { WipeProvider } from "./components/ui";
import { FrontPage } from "./routes/Front";
import { HeatmapPage } from "./routes/Heatmap";
import { MetricsPage } from "./routes/Metrics";
import { ProjectsPage } from "./routes/Projects";
import { SourcesPage } from "./routes/Sources";
import { StudioIndex } from "./routes/StudioIndex";
import { ControlRoom } from "./studio/ControlRoom";
import { PublishPage } from "./studio/PublishPage";
import { RenderGatePage } from "./studio/RenderGatePage";
import { StudioLayout } from "./studio/StudioLayout";

function RootLayout() {
  return (
    <WipeProvider>
      <Nav />
      <Outlet />
    </WipeProvider>
  );
}

function NotFound() {
  return (
    <main id="main" className="page">
      <div className="empty">
        <b>Off air</b>
        There is no screen at this address. <Link to="/">Back to the front</Link>
      </div>
    </main>
  );
}

function RouteError({ error }: { error: unknown }) {
  return (
    <main id="main" className="page">
      <div className="failure" role="alert">
        <b>This screen failed</b>
        <span className="mono">{error instanceof Error ? error.message : String(error)}</span>
        <Link to="/">Back to the front</Link>
      </div>
    </main>
  );
}

const SPORTS: readonly string[] = ["F1", "NBA", "NHL", "Soccer"];
const asMode = (v: unknown): Mode | undefined =>
  v === "non_commercial" ? "non_commercial" : v === "monetized" ? "monetized" : undefined;
const asSport = (v: unknown): Sport | undefined =>
  typeof v === "string" && SPORTS.includes(v) ? (v as Sport) : undefined;

const rootRoute = createRootRoute({ component: RootLayout, notFoundComponent: NotFound, errorComponent: RouteError });

export type FrontSearch = { format?: string; sport?: Sport; mode?: Mode };
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: (s: Record<string, unknown>): FrontSearch => ({
    format: typeof s.format === "string" ? s.format : undefined,
    sport: asSport(s.sport),
    mode: asMode(s.mode),
  }),
  component: FrontPage,
});

export type HeatmapSearch = { mode?: Mode; cell?: string };
const heatmapRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/heatmap",
  validateSearch: (s: Record<string, unknown>): HeatmapSearch => ({
    mode: asMode(s.mode),
    cell: typeof s.cell === "string" ? s.cell : undefined,
  }),
  component: HeatmapPage,
});

export type ProjectsSearch = { view?: "board" | "list" };
const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects",
  validateSearch: (s: Record<string, unknown>): ProjectsSearch => ({ view: s.view === "list" ? "list" : undefined }),
  component: ProjectsPage,
});

const studioIndexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/studio", component: StudioIndex });

export const studioRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/studio/$projectId",
  component: StudioLayout,
});
const controlRoute = createRoute({ getParentRoute: () => studioRoute, path: "/", component: ControlRoom });
const renderRoute = createRoute({ getParentRoute: () => studioRoute, path: "render", component: RenderGatePage });
const publishRoute = createRoute({ getParentRoute: () => studioRoute, path: "publish", component: PublishPage });

const metricsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/metrics", component: MetricsPage });
const sourcesRoute = createRoute({ getParentRoute: () => rootRoute, path: "/sources", component: SourcesPage });

const routeTree = rootRoute.addChildren([
  indexRoute,
  heatmapRoute,
  projectsRoute,
  studioIndexRoute,
  studioRoute.addChildren([controlRoute, renderRoute, publishRoute]),
  metricsRoute,
  sourcesRoute,
]);

export const router = createRouter({ routeTree, defaultPreload: "intent", scrollRestoration: true });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
