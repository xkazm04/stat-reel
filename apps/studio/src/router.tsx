/**
 * Code-based TanStack Router (DESIGN §6.1 revised by ADR 006): Front, Heatmap (grid layer +
 * cell layer), Rundown, Studio (compose + Render & Gate), Calendar, Board, Metrics, Sources.
 * The front has one component per theme; every other screen is one module in both themes.
 */
import type { Mode, Sport } from "@statreel/schemas";
import { createRootRoute, createRoute, createRouter, Link, Navigate, Outlet } from "@tanstack/react-router";
import { BoardPage } from "./board/BoardPage";
import { Nav } from "./components/Nav";
import { WipeProvider } from "./components/ui";
import { CalendarPage } from "./routes/Calendar";
import { FrontPage } from "./routes/Front";
import { FrontPhotoFinish } from "./routes/FrontPhotoFinish";
import { HeatmapPage } from "./routes/Heatmap";
import { HeatmapCellLayer } from "./routes/HeatmapCell";
import { MetricsPage } from "./routes/Metrics";
import { ProjectsPage } from "./routes/Projects";
import { SourcesPage } from "./routes/Sources";
import { StudioIndex } from "./routes/StudioIndex";
import { ControlRoom } from "./studio/ControlRoom";
import { RenderGatePage } from "./studio/RenderGatePage";
import { StudioLayout } from "./studio/StudioLayout";
import { useTheme } from "./theme";

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
export const asMode = (v: unknown): Mode | undefined =>
  v === "non_commercial" ? "non_commercial" : v === "monetized" ? "monetized" : undefined;
export const asSport = (v: unknown): Sport | undefined =>
  typeof v === "string" && SPORTS.includes(v) ? (v as Sport) : undefined;

const rootRoute = createRootRoute({ component: RootLayout, notFoundComponent: NotFound, errorComponent: RouteError });

/** The front: A/1's floodlit front in On Air, A/3's finish frame in Photo Finish. */
function FrontRoute() {
  const { theme } = useTheme();
  return theme === "photofinish" ? <FrontPhotoFinish /> : <FrontPage />;
}

export type FrontSearch = { format?: string; sport?: Sport; mode?: Mode };
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: (s: Record<string, unknown>): FrontSearch => ({
    format: typeof s.format === "string" ? s.format : undefined,
    sport: asSport(s.sport),
    mode: asMode(s.mode),
  }),
  component: FrontRoute,
});

/**
 * Heatmap layer 1 (the grid) is the parent; layer 2 (one cell) is a child rendered as a full layer
 * over the grid, so the grid keeps its place and focus when the layer closes.
 * `focus` = "<usecase>|<sport>" names the cell to focus on the grid (`cell` is its legacy name).
 */
export type HeatmapSearch = { mode?: Mode; focus?: string };
export const heatmapRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/heatmap",
  validateSearch: (s: Record<string, unknown>): HeatmapSearch => ({
    mode: asMode(s.mode),
    focus: typeof s.focus === "string" ? s.focus : typeof s.cell === "string" ? s.cell : undefined,
  }),
  component: HeatmapPage,
});
const heatmapIndexRoute = createRoute({ getParentRoute: () => heatmapRoute, path: "/", component: () => null });
export const heatmapCellRoute = createRoute({
  getParentRoute: () => heatmapRoute,
  path: "$usecase/$sport",
  component: HeatmapCellLayer,
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
/** Publishing moved to the Calendar (ADR 006); old links land there. */
const publishRoute = createRoute({
  getParentRoute: () => studioRoute,
  path: "publish",
  component: () => <Navigate to="/calendar" replace />,
});

const calendarRoute = createRoute({ getParentRoute: () => rootRoute, path: "/calendar", component: CalendarPage });
const boardRoute = createRoute({ getParentRoute: () => rootRoute, path: "/board", component: BoardPage });
const metricsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/metrics", component: MetricsPage });
const sourcesRoute = createRoute({ getParentRoute: () => rootRoute, path: "/sources", component: SourcesPage });

const routeTree = rootRoute.addChildren([
  indexRoute,
  heatmapRoute.addChildren([heatmapIndexRoute, heatmapCellRoute]),
  projectsRoute,
  studioIndexRoute,
  studioRoute.addChildren([controlRoute, renderRoute, publishRoute]),
  calendarRoute,
  boardRoute,
  metricsRoute,
  sourcesRoute,
]);

export const router = createRouter({ routeTree, defaultPreload: "intent", scrollRestoration: true });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
