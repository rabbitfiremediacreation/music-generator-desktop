/** Observe frame callbacks; these do not prove that the compositor displayed pixels. */
export function waitForPaint(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

/** Only the splash may proceed without frames, once its IPC connection is established. */
export function waitForSplashPaint(): Promise<"frames" | "timeout"> {
  return new Promise(resolve => {
    let finished = false;
    let frame: number | undefined;
    const timer = setTimeout(() => finish("timeout"), 500);
    function finish(result: "frames" | "timeout") {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (frame !== undefined) cancelAnimationFrame(frame);
      resolve(result);
    }
    frame = requestAnimationFrame(() => {
      if (finished) return;
      frame = requestAnimationFrame(() => finish("frames"));
    });
  });
}
