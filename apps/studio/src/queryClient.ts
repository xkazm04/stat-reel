/** The one QueryClient: shared by the providers (main.tsx) and the route loaders (router.tsx). */
import { QueryClient } from "@tanstack/react-query";

/**
 * Window focus and reconnect refetches are off here: freshness.ts does the same job only when it
 * matters (tab hidden > 30 s, or the network came back), over active queries, in one invalidation.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, refetchOnReconnect: false, staleTime: 5_000 },
  },
});
