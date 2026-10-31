/** Allow a visible webview to render before acknowledging startup readiness. */
export function waitForPaint(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}
