/** Per-viewer conveniences in localStorage (never state that must persist): last opened project. */
const KEY = "statreel.studio.lastProject";

export function lastProjectId(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function rememberProject(id: string): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // storage blocked: fine, the rail falls back to /projects
  }
}
