/**
 * The drawing of the Preview button icon (design decision 26): a window with a pane on its right.
 * The part with the class `av-pane-fill` is the pane, which a style rule shows only while the pane
 * is open. The Preview buttons of the Assignments list (DOM nodes) and of the weekly card (Preact
 * elements) both draw from this one description, so the two icons cannot drift apart.
 */

/** The attributes of the `svg` element. A rule of the host sets its size. */
export const PANE_ICON_ATTRIBUTES: Readonly<Record<string, string>> = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '2',
  'aria-hidden': 'true',
  focusable: 'false',
};

/** The shapes in the `svg` element: the tag and the attributes of each. */
export const PANE_ICON_SHAPES: readonly (readonly [
  tag: string,
  attributes: Record<string, string>,
])[] = [
  ['rect', { x: '3', y: '4', width: '18', height: '16', rx: '2' }],
  ['path', { d: 'M15 4v16' }],
  [
    'rect',
    { class: 'av-pane-fill', x: '15', y: '4', width: '6', height: '16', fill: 'currentColor' },
  ],
];
