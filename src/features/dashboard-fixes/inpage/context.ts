/**
 * What every fix gets from the controller. See docs/design.md, decision 22.
 *
 * A fix is idempotent: `apply` runs after every batch of page changes and does nothing when the
 * page already shows its work. It never removes or edits a node that React owns. It adds its own
 * nodes, which carry a `data-wr-` attribute, and sets `data-wr-` attributes on React nodes that a
 * stylesheet then styles. `remove` undoes all of it.
 */
import type { DataMessage } from '../../weekly-list/data/protocol';
import type { DashboardData } from '../protocol';

export interface FixContext {
  doc: Document;
  /** The origin of the page, which is the saved Canvas. */
  origin: string;
  /** The last data of the background, or `null` until it arrives. */
  data: DashboardData | null;
  /** Sends a message to the background. A failure rejects. */
  send(message: DataMessage): Promise<unknown>;
  /** Sets the named block of the fixes stylesheet. `null` removes the block. */
  css(name: string, css: string | null): void;
  /** Asks for another pass, for example after a request answered. */
  again(): void;
}

export interface Fix {
  apply(context: FixContext): void;
  /** The background has new data: the fix forgets what failed. */
  reload?(): void;
  /** Undoes everything the fix did to the page. */
  remove(): void;
}

/** Whether a node belongs to a fix, so the controller can ignore the changes it makes itself. */
export function isFixNode(node: Node): boolean {
  return node.nodeType === 1 && (node as Element).hasAttribute('data-wr-own');
}

/** A new element with a class and text. */
export function h(doc: Document, tag: string, className: string, text?: string): HTMLElement {
  const node = doc.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
