/**
 * The dock of a pane: a card with a gap around it that can fill the window. The weekly list dock
 * is no card, so the rules of a card live here and only the panes carry them.
 */
import { CARD_GAP_PX, createDock, type Dock, type DockOptions } from './dock';

const CARD_CSS = `:host([data-card]){box-sizing:border-box;padding:${CARD_GAP_PX}px ${CARD_GAP_PX}px ${CARD_GAP_PX}px 0;pointer-events:none}
:host([data-card][data-full]){padding:${CARD_GAP_PX}px;pointer-events:auto}
:host([data-card]) section{position:relative;overflow:hidden;border:1px solid var(--line);border-radius:10px;box-shadow:0 2px 14px rgba(0,0,0,.2);pointer-events:auto}
:host([data-card][data-theme='dark']) section{box-shadow:0 2px 14px rgba(0,0,0,.55)}
:host([data-card]) .handle{z-index:1;top:${CARD_GAP_PX}px;height:calc(100% - ${2 * CARD_GAP_PX}px);pointer-events:auto}
:host([data-card][data-full]) .handle{display:none}
@media(max-width:899px){:host([data-card]){padding:0}:host([data-card]) section{border:0;border-left:1px solid var(--edge);border-radius:0;box-shadow:none}}
`;

/** Makes the dock of a pane, with the rules of a card. */
export function createCardDock(options: Omit<DockOptions, 'card' | 'css'>): Dock {
  return createDock({ ...options, card: true, css: CARD_CSS });
}
