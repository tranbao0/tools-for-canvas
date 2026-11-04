/**
 * The content of one open assignment, as inert DOM nodes for the shadow root of its row. See
 * docs/design.md, decision 26. Every text that a teacher wrote goes through the shared sanitizer.
 */
import { submitLabel } from '../turnIn';
import { assignmentTags } from '../chips';
import { formatDateTime } from '../format';
import type { AssignmentDetails, AssignmentDetailsReply } from '../protocol';
import { renderComments, renderFiles, renderInstructions, renderRubric } from '../render';

export interface DetailsContext {
  doc: Document;
  /** The saved Canvas, which is the origin of the page. */
  origin: string;
  courseId: string;
  now(): Temporal.Instant;
}

/** Whether a background reply has the parts that the view reads. */
export function isDetailsReply(value: unknown): value is AssignmentDetailsReply {
  if (typeof value !== 'object' || value === null) return false;
  const { details, timeZone } = value as Partial<AssignmentDetailsReply>;
  return (
    typeof timeZone === 'string' &&
    typeof details?.assignment?.id === 'string' &&
    typeof details.submission?.user_id === 'string'
  );
}

function node(doc: Document, tag: string, className: string, text?: string): HTMLElement {
  const made = doc.createElement(tag);
  made.className = className;
  if (text !== undefined) made.textContent = text;
  return made;
}

/** The score text: "5 / 10", with the grade when it differs, or why there is no score. */
export function scoreText(details: AssignmentDetails): string {
  const { assignment, submission } = details;
  if (submission.excused === true) return 'Excused';
  if (submission.score === null) return 'Not graded yet';
  const total = assignment.points_possible === null ? '' : ` / ${assignment.points_possible}`;
  const grade =
    submission.grade !== null && submission.grade !== String(submission.score)
      ? ` (${submission.grade})`
      : '';
  return `${submission.score}${total}${grade}`;
}

function fact(doc: Document, label: string, value: string): HTMLElement {
  const group = node(doc, 'div', 'av-fact');
  group.append(node(doc, 'dt', 'av-label', label), node(doc, 'dd', 'av-value', value));
  return group;
}

function summary(reply: AssignmentDetailsReply, context: DetailsContext): HTMLElement {
  const { doc } = context;
  const { details, timeZone } = reply;
  const top = node(doc, 'div', 'av-summary');
  const facts = node(doc, 'dl', 'av-facts');
  facts.append(fact(doc, 'Score', scoreText(details)));
  facts.prepend(
    fact(doc, 'Due', formatDateTime(details.assignment.due_at, timeZone) ?? 'No due date'),
  );
  const submitted = formatDateTime(details.submission.submitted_at, timeZone);
  if (submitted !== null) facts.append(fact(doc, 'Submitted', submitted));
  top.append(facts);
  const tags = assignmentTags(details, context.now(), timeZone);
  if (tags.length > 0) {
    const list = node(doc, 'ul', 'av-chips');
    for (const tag of tags) {
      const item = doc.createElement('li');
      item.append(
        node(
          doc,
          'span',
          tag.shape === 'chip'
            ? `av-chip${tag.tone === 'missing' ? ' av-chip-missing' : ''}`
            : 'av-marker',
          tag.label,
        ),
      );
      if (tag.tip !== null) item.lastElementChild?.setAttribute('title', tag.tip);
      list.append(item);
    }
    top.append(list);
  }
  return top;
}

/** The content of an open row of the Assignments list, top to bottom (decision 26). */
export function renderDetails(reply: AssignmentDetailsReply, context: DetailsContext): HTMLElement {
  const { doc, origin, courseId } = context;
  const { details, timeZone } = reply;
  const panel = node(doc, 'div', 'av-content');
  const open = node(doc, 'a', 'av-button', 'Open assignment');
  open.setAttribute(
    'href',
    new URL(
      `/courses/${encodeURIComponent(courseId)}/assignments/${encodeURIComponent(details.assignment.id)}`,
      origin,
    ).href,
  );
  panel.append(
    summary(reply, context),
    renderInstructions(details, { origin, doc }),
    renderRubric(details, doc),
    renderComments(details, { origin, courseId, doc, timeZone }),
    renderFiles(details, { origin, courseId, doc }),
    node(doc, 'div', 'av-actions'),
  );
  const label = submitLabel(details);
  if (label !== null) {
    const submit = node(doc, 'button', 'av-button', label);
    submit.setAttribute('type', 'button');
    submit.dataset['action'] = 'submit';
    panel.lastElementChild?.append(submit);
  }
  panel.lastElementChild?.append(open);
  return panel;
}

export function renderLoading(doc: Document): HTMLElement {
  const loading = node(doc, 'p', 'av-state', 'Loading details');
  loading.setAttribute('role', 'status');
  return loading;
}

export function renderError(doc: Document): HTMLElement {
  const wrap = node(doc, 'div', 'av-state av-error');
  wrap.setAttribute('role', 'alert');
  const retry = node(doc, 'button', 'av-button', 'Retry');
  retry.setAttribute('type', 'button');
  retry.dataset['action'] = 'retry';
  wrap.append(node(doc, 'span', 'av-error-text', "Can't load the details."), retry);
  return wrap;
}
