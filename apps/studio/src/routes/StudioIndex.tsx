/** /studio without a project: cut to the newest project, or say honestly that there is none. */
import { Link, Navigate } from "@tanstack/react-router";
import { Empty, Failure, Loading } from "../components/ui";
import { useProjects } from "../data";

export function StudioIndex() {
  const pr = useProjects();
  if (pr.isLoading)
    return (
      <main id="main" className="page">
        <Loading what="the rundown" />
      </main>
    );
  if (pr.isError)
    return (
      <main id="main" className="page">
        <Failure error={pr.error} what="The rundown" />
      </main>
    );
  const newest = [...(pr.data?.projects ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (newest) return <Navigate to="/studio/$projectId" params={{ projectId: newest.id }} replace />;
  return (
    <main id="main" className="page">
      <Empty title="No project yet — create one from a Go cell">
        The control room opens on a project. Open the <Link to="/heatmap">rights grid</Link>, pick a Go cell, then
        Create project.
      </Empty>
    </main>
  );
}
