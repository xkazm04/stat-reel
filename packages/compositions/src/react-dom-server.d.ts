/** Minimal typing for tests: @types/react-dom is not installed in this workspace. */
declare module "react-dom/server" {
  import type { ReactNode } from "react";
  export function renderToStaticMarkup(element: ReactNode): string;
}
