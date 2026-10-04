import { describe, expect, it, vi } from "vitest";
import { retryClick } from "./RetryButton";

/** A click as it reaches the Front's "Open the rundown" way: the Retry sits inside a router Link. */
function clickInsideLink(onRetry: () => void) {
  const ev = {
    defaultPrevented: false,
    stopped: false,
    preventDefault() {
      ev.defaultPrevented = true;
    },
    stopPropagation() {
      ev.stopped = true;
    },
  };
  retryClick(onRetry)(ev);
  // @tanstack/react-router link.js handleClick navigates only when `!e.defaultPrevented`
  const linkNavigates = !ev.stopped && !ev.defaultPrevented;
  return { linkNavigates };
}

describe("RetryButton retries in place", () => {
  it("retries once and the enclosing link does not navigate away", () => {
    const onRetry = vi.fn();
    expect(clickInsideLink(onRetry).linkNavigates).toBe(false);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
