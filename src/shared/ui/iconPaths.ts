/**
 * The paths of the icons that a script outside the extension pages also draws, such as the header
 * of a pane on a Canvas page. They are 120 grid paths (see icons.tsx).
 */
export const CLOSE_PATH = 'm60 52-33-33-8 8 33 33-33 33 8 8 33-33 33 33 8-8-33-33 33-33-8-8z';

export const EXTERNAL_LINK_PATH =
  'M76.7 16.7c5.5 0 10 4.5 10 10v26.7H80v-10H6.7v50C6.7 95.2 8.2 96.7 10 96.7h66.7c1.8 0 3.3 -1.5 3.3 -3.3v-13.3h6.7v13.3c0 5.5 -4.5 10 -10 10H10c-5.5 0 -10 -4.5 -10 -10V26.7c0 -5.5 4.5 -10 10 -10Zm22.4 27.6 20 20c1.3 1.3 1.3 3.4 0 4.7l-20 20 -4.7 -4.7 14.3 -14.3H56.7V63.4h52L94.3 49l4.7 -4.7Zm-22.4 -21H10c-1.8 0 -3.3 1.5 -3.3 3.3v10H80V26.7c0 -1.8 -1.5 -3.3 -3.3 -3.3Z';

/** A calendar with a check mark, for the tab of the minimized weekly list. */
export const CALENDAR_CHECK_PATH =
  'M20 10h10V0h10v10h40V0h10v10h20v110H10V10h10zm0 30v70h80V40H20zm0-20v10h80V20H20zm12 57 6-6 14 14 30-31 6 6-36 37z';

/** Four corner marks that point outward: the pane fills the window. */
export const FULL_VIEW_PATH =
  'M10 10h35v10H20v25H10zM110 10v35h-10V20H75V10zM10 110V75h10v25h25v10zM110 110H75v-10h25V75h10z';

/** Four corner marks that point inward: the pane goes back to its place. */
export const EXIT_FULL_VIEW_PATH =
  'M35 10h10v35H10V35h25zM75 10h10v25h25v10H75zM10 75h35v35H35V85H10zM75 75h35v10H85v25H75z';
