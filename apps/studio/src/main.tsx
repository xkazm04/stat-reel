import "@statreel/design-tokens/tokens.css";
import "./styles/base.css";
import "./styles/photofinish.css";
import "./styles/front-pf.css";
import "./styles/heatmap.css";
import "./styles/studio.css";
import "./styles/calendar.css";
import "./styles/pages.css";
import "./styles/arrive.css";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { EventsProvider } from "./events";
import { installFreshness } from "./freshness";
import { queryClient } from "./queryClient";
import { router } from "./router";
import { dropStaleTheme } from "./theme";

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");
dropStaleTheme();
installFreshness(queryClient);

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <EventsProvider>
        <RouterProvider router={router} />
      </EventsProvider>
    </QueryClientProvider>
  </StrictMode>,
);
