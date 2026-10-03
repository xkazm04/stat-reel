/**
 * The programme monitor, loaded on demand: @remotion/player is large and only the monitor needs it,
 * so it is a chunk of its own. Without props the monitor is only the slate, so the chunk is not
 * requested at all (a Front or control room with no project never downloads Remotion); with props,
 * the slate stands in while the implementation arrives, so the frame is already the right size.
 */
import { type ComponentProps, lazy, memo, Suspense, useEffect } from "react";

const Impl = lazy(() => import("./Programme").then((m) => ({ default: m.Programme })));

export const Programme = memo(function Programme(props: ComponentProps<typeof Impl>) {
  const { onMeta } = props;
  const hasProps = !!props.props;
  // the implementation reports its meta while mounted; the slate has none
  useEffect(() => {
    if (!hasProps) onMeta?.(null);
  }, [hasProps, onMeta]);
  if (!hasProps) return <>{props.slate}</>;
  return (
    <Suspense fallback={props.slate}>
      <Impl {...props} />
    </Suspense>
  );
});
