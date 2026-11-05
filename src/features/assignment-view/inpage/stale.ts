/**
 * The cleanup of what a dead copy of the view left in the page (design decision 26). An extension
 * update can end a copy with its nodes and its panes in the page, and the new copy has no
 * reference to them. The sweep reaches only the parts of the page that the view owns.
 */
import { giveBackRoom } from '../../file-viewer/dock';
import { restoreStaleComments } from './comments';
import { COMMENT_TEXT, ORIGINAL, OWN, realContainer, rightColumn } from './own';
import { RUBRIC_WRAPPER_ID, restoreStaleRubric } from './rubric';

/** The text of other people that Canvas shows in the Submission box. A sweep never goes into it. */
const COMMENTS = '.comments';

/** The nodes of the root that match, except those in the comments of Canvas. */
function inOwnedPart(root: ParentNode, selector: string): Element[] {
  return [...root.querySelectorAll(selector)].filter((node) => node.closest(COMMENTS) === null);
}

/**
 * The own node with this id that stands where the view puts it, or `null`. The text of another
 * author can hold a node with the same id and the mark of the view, so a node counts only at the
 * place that `at` names, and never inside the comments.
 */
function ownNode(doc: Document, id: string, at: (node: Element) => boolean): Element | null {
  for (const node of doc.querySelectorAll(`[id="${id}"]`)) {
    if (node.hasAttribute(OWN) && node.closest(COMMENT_TEXT) === null && at(node)) return node;
  }
  return null;
}

/** The files frame that Canvas draws in the real container. */
function realFrame(doc: Document): Element | null {
  const children = realContainer(doc)?.children ?? [];
  return (
    [...children].find((child) => child.classList.contains('submission-details-frame')) ?? null
  );
}

/** The host of the instructions stands before the real container, or after the real frame in it. */
const isHostPlace = (node: Element): boolean => {
  const container = realContainer(node.ownerDocument);
  if (container === null) return false;
  return (
    node.nextElementSibling === container ||
    (node.parentElement === container &&
      node.previousElementSibling === realFrame(node.ownerDocument))
  );
};

/** The panes of the dock stand in the body. */
const isPanePlace = (node: Element): boolean => node.parentElement === node.ownerDocument.body;

/** The wrapper of the rubric stands in the real host of the instructions, or in the real frame. */
const isRubricPlace = (node: Element): boolean => {
  const doc = node.ownerDocument;
  const parent = node.parentElement;
  if (parent === null) return false;
  return parent === realFrame(doc) || parent === ownNode(doc, 'av-submission-details', isHostPlace);
};

/**
 * Puts the nodes of Canvas back in the place of the own nodes that hold them. Only a holder that
 * is a direct child of a link, inside the root, counts: that is where the sidebar view puts it.
 */
export function giveBackOriginals(root: ParentNode): void {
  for (const holder of inOwnedPart(root, `a[href] > [${ORIGINAL}][${OWN}]`))
    holder.replaceWith(...holder.childNodes);
}

/** The assignment page, with its Submission box in the right column. */
const ASSIGNMENT_PAGE = /^\/courses\/\d+(?:~\d+)?\/assignments\/\d+(?:~\d+)?\/?$/;
const SUBMISSION_PAGE = /^\/courses\/\d+(?:~\d+)?\/assignments\/\d+(?:~\d+)?\/submissions\//;

/**
 * The ids of the two panes that this view docks in the body: the feedback pane and the assignment
 * pane. An earlier copy of the script can leave one behind when it dies with its pane open.
 */
export const STALE_PANE_IDS: readonly string[] = ['tools-feedback', 'tools-turn-in'];

/**
 * The parts of the page where the view of this page puts its nodes, and nothing else. The text of
 * other authors (a description, a comment) sits elsewhere, so a sweep never reaches it:
 * - the assignment page: the content of the Submission box, `#sidebar_content .details .content`;
 * - the Submission Details page: the head, which holds the style, the host, by its id, the
 *   container of the title row's buttons, `.ic-Action-header__Secondary`, which holds the own link,
 *   and the right column `#right-side`, which holds the Submission box. The comments column goes
 *   home before the sweep, so a comment of another author is never inside this root;
 * - the Assignments list: the head, and the lists that hold the rows with their buttons.
 * The panes in the body go by their ids on the pages that dock them.
 */
function ownedRoots(doc: Document, pathname: string): Element[] {
  if (ASSIGNMENT_PAGE.test(pathname)) {
    // A comment can hold its own `.content` inside `.details`: only the box's own counts.
    return [...doc.querySelectorAll('#sidebar_content .details .content')].filter(
      (root) => root.closest('.comments') === null,
    );
  }
  for (const id of STALE_PANE_IDS) ownNode(doc, id, isPanePlace)?.remove();
  const roots = new Set<Element>([doc.head]);
  if (SUBMISSION_PAGE.test(pathname)) {
    ownNode(doc, 'av-submission-details', isHostPlace)?.remove();
    const buttons = doc.querySelector('.ic-Action-header__Secondary');
    if (buttons) roots.add(buttons);
    const column = rightColumn(doc);
    if (column) roots.add(column);
    return [...roots];
  }
  for (const row of doc.querySelectorAll('.ig-row[id^=assignment_]')) {
    if (row.parentElement) roots.add(row.parentElement);
  }
  return [...roots];
}

/** Removes what an earlier copy of this script left in the parts of the page that the view owns. */
export function removeStaleView(
  doc: Document = document,
  pathname: string = doc.defaultView?.location.pathname ?? '',
): void {
  // Canvas's rubric and comments go back home first, while the wrappers that hold them are still
  // on the page. A comment of another author can hold marks of the view, so the comments must be
  // home before the sweep.
  restoreStaleRubric(doc);
  restoreStaleComments(doc);
  ownNode(doc, RUBRIC_WRAPPER_ID, isRubricPlace)?.remove();
  const roots = ownedRoots(doc, pathname);
  // The hosts of dead panes are gone now, so the room that they took goes back.
  giveBackRoom(doc);
  for (const root of roots) {
    giveBackOriginals(root);
    for (const node of inOwnedPart(root, `[${OWN}]`)) node.remove();
    for (const element of [root, ...inOwnedPart(root, '*')]) {
      for (const name of element.getAttributeNames()) {
        if (name.startsWith('data-av-')) element.removeAttribute(name);
      }
    }
  }
}
