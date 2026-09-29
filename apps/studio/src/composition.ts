/**
 * Loads `EraAdjustedSlope` and its metadata (COMPOSITIONS, FPS, durationInFramesFor) from
 * @statreel/compositions lazily, so the Remotion/viz code is a separate chunk. A load failure
 * becomes a labelled placeholder in the player, never a fake render.
 */
import type { EraAdjustedProps, Format } from "@statreel/schemas";
import { type ComponentType, useEffect, useState } from "react";

export type CompositionInfo =
  | { status: "loading" }
  | { status: "missing"; reason: string }
  | {
      status: "ready";
      Component: ComponentType<Record<string, unknown>>;
      fps: number;
      /** frames for a given props object (timing-driven, as calculateMetadata does) */
      durationInFrames: (props: EraAdjustedProps) => number;
      dimensions: (format: Format) => { width: number; height: number };
    };

let cached: Promise<CompositionInfo> | null = null;

export function loadComposition(): Promise<CompositionInfo> {
  cached ??= import("@statreel/compositions").then(
    (mod): CompositionInfo => {
      if (!mod.EraAdjustedSlope)
        return { status: "missing", reason: "@statreel/compositions does not export EraAdjustedSlope" };
      return {
        status: "ready",
        Component: mod.EraAdjustedSlope as unknown as ComponentType<Record<string, unknown>>,
        fps: mod.FPS,
        durationInFrames: (props) => mod.durationInFramesFor(props.timing, mod.FPS),
        dimensions: (format) => {
          const c = mod.COMPOSITIONS.find((x) => x.format === format && x.component === "EraAdjustedSlope");
          return c
            ? { width: c.width, height: c.height }
            : format === "vertical"
              ? { width: 1080, height: 1920 }
              : { width: 1920, height: 1080 };
        },
      };
    },
    (err: unknown): CompositionInfo => ({
      status: "missing",
      reason: `@statreel/compositions failed to load: ${err instanceof Error ? err.message : String(err)}`,
    }),
  );
  return cached;
}

export function useComposition(): CompositionInfo {
  const [info, setInfo] = useState<CompositionInfo>({ status: "loading" });
  useEffect(() => {
    let live = true;
    void loadComposition().then((i) => live && setInfo(i));
    return () => {
      live = false;
    };
  }, []);
  return info;
}
