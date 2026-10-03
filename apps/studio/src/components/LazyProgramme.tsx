/**
 * The programme monitor, loaded on demand: @remotion/player is large and only the monitor needs it,
 * so it is a chunk of its own. While it arrives the monitor shows what it would show without
 * props (the slate), so the frame is already the right size and nothing jumps.
 */
import { type ComponentProps, lazy, Suspense } from "react";

const Impl = lazy(() => import("./Programme").then((m) => ({ default: m.Programme })));

export function Programme(props: ComponentProps<typeof Impl>) {
  return (
    <Suspense fallback={props.slate}>
      <Impl {...props} />
    </Suspense>
  );
}
