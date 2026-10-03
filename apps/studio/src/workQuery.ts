/**
 * What the owner has in hand, read for the Front and the Rundown's empty state: the topic heatmap
 * (accepted cases, generation counts, the video ledger) and the Board (accepted / pending items).
 * Query options sit apart from the hook so the route loaders warm the same cache entries; the
 * board key is the Board route's own (qk.board), so one fetch serves both screens.
 */
import { useQuery } from "@tanstack/react-query";
import { api, qk } from "./api";
import { heatmapTopicsQuery, useHeatmapTopics } from "./data";
import { type OnTheLine, onTheLine } from "./frontpf";

export const boardQuery = { queryKey: qk.board, queryFn: () => api.board() } as const;
/** The topic heatmap with accepted-case topics (include_empty=1) as the panel reads it. */
export const lineTopicsQuery = heatmapTopicsQuery(false);

export type OnTheLineState =
  | { status: "loading" }
  | { status: "error"; error: unknown; what: string }
  | { status: "ready"; line: OnTheLine; /** one of the two sources did not answer */ partial: string | null };

/** Each source can fail on its own; the panel counts what answered and names what did not. */
export function useOnTheLine(): OnTheLineState {
  const topics = useHeatmapTopics(false);
  const board = useQuery(boardQuery);
  if (topics.isError && board.isError) return { status: "error", error: topics.error, what: "The topic heatmap and the Board" };
  if (topics.isLoading || board.isLoading) return { status: "loading" };
  const partial = topics.isError ? "topic heatmap" : board.isError ? "Board" : null;
  return {
    status: "ready",
    line: onTheLine(topics.data?.topics ?? [], board.data?.items ?? []),
    partial,
  };
}
