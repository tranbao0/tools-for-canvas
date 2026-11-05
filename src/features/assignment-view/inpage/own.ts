/** Marks every node that the view adds, so the observer and the cleanup can tell them. */
export const OWN = 'data-av-own';

/**
 * Marks an own node that holds nodes of Canvas, which the view moved into it. Giving the nodes
 * back must come before any removal of own nodes.
 */
export const ORIGINAL = 'data-av-original';
