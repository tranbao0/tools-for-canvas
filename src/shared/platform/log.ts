/**
 * Local console logging for failures that have no UI. Nothing leaves the browser.
 */

/** Writes a warning for a failed background step. */
export function logFailure(step: string, error: unknown): void {
  console.warn(`[weekrow] ${step} failed`, error);
}
