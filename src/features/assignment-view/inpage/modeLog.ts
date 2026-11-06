/**
 * The console lines of the Submission Details page. The page keeps Canvas's files frame in some
 * cases, and a reason code in the console tells which one, so a page that stays as Canvas drew it
 * can be diagnosed. A line holds names only: a reason code, and for a mount error the name and
 * message of the error. It never holds an address or a file name. Nothing leaves the browser.
 */

/** Why the page keeps Canvas's files frame (the mode 'above'). */
export type AboveReason =
  /** The submission type is one that the view does not show. */
  | 'type'
  /** The report data of a file has a form that the view cannot show. */
  | 'report-data'
  /** Canvas's script drew a report of an asset processor in the frame. */
  | 'asset-reports'
  /** A session address failed the check, and no row of the frame has given a good one yet. */
  | 'no-session';

export function logAbove(reason: AboveReason): void {
  console.warn(`[weekrow] submission details keeps the Canvas frame, reason: ${reason}`);
}

/** A file whose session address failed the check has only the frame as a source for its button. */
export function logNoFeedbackAddress(count: number): void {
  console.warn(`[weekrow] submission details: ${count} file(s) without a usable feedback address`);
}

/** The text of an error without an address: a word that holds a slash is left out. */
function safe(text: string): string {
  return text.replace(/\S*\/\S*/g, '<address>').slice(0, 200);
}

/** What a failed mount leaves: Canvas's frame with the instructions above it, or the page as Canvas drew it. */
export type MountOutcome = 'above' | 'given-back';

/** One line for one failed mount, with the reason code and the name and message of the error. */
export function logMountFailure(error: unknown, outcome: MountOutcome): void {
  const name = error instanceof Error ? error.name : 'Error';
  const message = error instanceof Error ? error.message : '';
  const what =
    outcome === 'above' ? 'keeps the Canvas frame' : 'gives the page back as Canvas drew it';
  console.warn(
    `[weekrow] submission details ${what}, reason: mount-failed (${name}: ${safe(message)})`,
  );
}
