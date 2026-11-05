/**
 * The console lines of the Submission Details page. The page keeps Canvas's files frame in some
 * cases and shows a mount error in others, and a reason code in the console tells which one, so a
 * page that stays as Canvas drew it can be diagnosed. A line holds names only: a reason code, or
 * the name and message of an error. It never holds an address or a file name. Nothing leaves the
 * browser.
 */

/** Why the page keeps Canvas's files frame (the mode 'above'). */
export type AboveReason =
  /** The submission type is one that the view does not show. */
  | 'type'
  /** The report data of a file or of a text entry has a form that the view cannot show. */
  | 'report-data'
  /** Canvas's script drew a report of an asset processor in the frame. */
  | 'asset-reports'
  /** The replace mode could not be set up. */
  | 'mount-failed';

export function logAbove(reason: AboveReason): void {
  console.warn(`[weekrow] submission details keeps the Canvas frame, reason: ${reason}`);
}

/** A file whose session address failed the check gets no feedback button. */
export function logNoFeedbackAddress(count: number): void {
  console.warn(`[weekrow] submission details: ${count} file(s) without a usable feedback address`);
}

/** The text of an error without an address: a word that holds a slash is left out. */
function safe(text: string): string {
  return text.replace(/\S*\/\S*/g, '<address>').slice(0, 200);
}

export function logMountFailure(error: unknown): void {
  const name = error instanceof Error ? error.name : 'Error';
  const message = error instanceof Error ? error.message : '';
  console.warn(`[weekrow] submission details mount failed: ${name}: ${safe(message)}`);
}
