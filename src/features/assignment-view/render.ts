import { sanitizeHtml } from '../../shared/ui/sanitize';
import type { AssignmentDetails } from './protocol';

/** Builds inert content nodes for the Submission Details view. */

export interface RenderContext {
  origin: string;
  courseId: string;
}

function element(doc: Document, tag: string, className?: string, text?: string): HTMLElement {
  const node = doc.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The address of one file of a submission, in the shape that the file pane takes (decision 25). */
export function submissionFileUrl(
  details: AssignmentDetails,
  context: RenderContext,
  fileId: string,
): URL {
  const path = `/courses/${encodeURIComponent(context.courseId)}/assignments/${encodeURIComponent(details.assignment.id)}/submissions/${encodeURIComponent(details.submission.user_id)}`;
  const url = new URL(path, context.origin);
  url.searchParams.set('download', fileId);
  return url;
}

/** The teacher's instructions, sanitized. The button shows or hides the rest of a long text. */
export function renderInstructions(
  details: AssignmentDetails,
  context: Pick<RenderContext, 'origin'> & { doc: Document },
): HTMLElement {
  const { doc, origin } = context;
  const node = element(doc, 'section', 'av-section av-instructions');
  node.append(element(doc, 'h3', 'av-heading', 'Instructions'));
  const html = details.assignment.description;
  if (html === null || html.trim() === '') {
    node.append(element(doc, 'p', 'av-empty', 'No instructions.'));
    return node;
  }
  const body = element(doc, 'div', 'av-body');
  body.append(sanitizeHtml(html, { origin, doc }));
  const more = element(doc, 'button', 'av-link', 'Show more');
  more.setAttribute('type', 'button');
  more.setAttribute('aria-expanded', 'false');
  more.dataset['action'] = 'more';
  more.hidden = true;
  node.append(body, more);
  return node;
}
