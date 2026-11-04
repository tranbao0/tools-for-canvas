/**
 * The reasons with which the background refuses a read for the student's session. A page asks
 * again after a failed read, except for these reasons, which an answer a moment later cannot lift.
 */
export const NOT_SAVED_CANVAS = 'Only the saved Canvas may ask for its data';
export const VIEWER_UNCONFIRMED = 'The cookie is not confirmed for the viewer';
export const VIEWER_COOKIE_CHANGED = 'The viewer cookie changed';
export const VIEWER_READ_COOKIE_CHANGED = 'The cookie changed during the viewer read';

export const SESSION_REFUSALS: ReadonlySet<string> = new Set([
  NOT_SAVED_CANVAS,
  VIEWER_UNCONFIRMED,
  VIEWER_COOKIE_CHANGED,
  VIEWER_READ_COOKIE_CHANGED,
]);
