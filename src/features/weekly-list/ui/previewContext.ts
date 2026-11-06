/**
 * What the rows of the in-page card read to show a Preview button (design decision 26). The card
 * of a page that has the assignment pane provides it. The side panel provides none, so its rows
 * have no button.
 */
import { createContext } from 'preact';
import type { PaneRef, PreviewRequest } from '../../assignment-view/preview';

export interface PreviewControl {
  /** The assignment that the pane shows now, or `null`. */
  shown: PaneRef | null;
  /** Asks the pane to show the assignment, or to close when it shows that assignment. */
  request(request: PreviewRequest): void;
}

export const PreviewContext = createContext<PreviewControl | null>(null);
