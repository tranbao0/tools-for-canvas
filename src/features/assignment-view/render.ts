import { sanitizeHtml } from '../../shared/ui/sanitize';
import { formatDateTime } from './format';
import type { AssignmentDetails } from './protocol';

/** Builds inert content nodes for the shadow root of an expanded assignment. */

interface RenderContext {
  origin: string;
  courseId: string;
  doc: Document;
}

function element(doc: Document, tag: string, className?: string, text?: string): HTMLElement {
  const node = doc.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function section(doc: Document, className: string, title: string): HTMLElement {
  const node = element(doc, 'section', `av-section ${className}`);
  node.append(element(doc, 'h3', 'av-heading', title));
  return node;
}

/** The address of one file of a submission, in the shape that the file pane takes (decision 25). */
function submissionFileUrl(
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
  context: Pick<RenderContext, 'origin' | 'doc'>,
): HTMLElement {
  const { doc, origin } = context;
  const node = section(doc, 'av-instructions', 'Instructions');
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

export function renderRubric(details: AssignmentDetails, doc: Document): HTMLElement {
  const node = section(doc, 'av-rubric', 'Rubric');
  const hidePoints = details.assignment.rubric_settings?.hide_points === true;
  for (const criterion of details.assignment.rubric ?? []) {
    const group = element(doc, 'section', 'av-criterion');
    group.append(element(doc, 'h4', 'av-subheading', criterion.description));
    if (criterion.long_description) {
      group.append(element(doc, 'p', 'av-note', criterion.long_description));
    }
    const assessments = details.submission.rubric_assessment;
    // An own key only: a criterion id such as `constructor` must not find an inherited member.
    const assessment =
      assessments !== undefined && Object.hasOwn(assessments, criterion.id)
        ? assessments[criterion.id]
        : undefined;
    const ratings = element(doc, 'ul', 'av-ratings');
    for (const rating of criterion.ratings) {
      const item = element(doc, 'li', 'av-rating');
      item.append(
        doc.createTextNode(
          `${rating.description}${hidePoints ? '' : ` (${rating.points} points)`}`,
        ),
      );
      if (assessment?.rating_id === rating.id) {
        item.dataset['assessed'] = 'true';
        item.append(element(doc, 'span', 'av-mark', 'Your assessment'));
      }
      if (rating.long_description) {
        item.append(element(doc, 'span', 'av-note', rating.long_description));
      }
      ratings.append(item);
    }
    group.append(ratings);
    if (assessment !== undefined) {
      group.append(
        element(
          doc,
          'p',
          'av-result',
          hidePoints || assessment.points === undefined
            ? 'Assessed'
            : `Your points: ${assessment.points} / ${criterion.points}`,
        ),
      );
      if (assessment.comments) group.append(element(doc, 'p', 'av-note', assessment.comments));
    }
    node.append(group);
  }
  if (!details.assignment.rubric?.length) {
    node.append(element(doc, 'p', 'av-empty', 'No rubric.'));
  }
  return node;
}

/** Includes student comments in their own section without inferring the roles of other authors. */
export function renderComments(
  details: AssignmentDetails,
  context: RenderContext & { timeZone?: string },
): HTMLElement {
  const { doc, origin } = context;
  const node = section(doc, 'av-comments', 'Comments');
  const comments = [...(details.submission.submission_comments ?? [])].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  );
  for (const comment of comments) {
    const article = element(doc, 'article', 'av-comment');
    article.dataset['author'] = comment.author_id === details.submission.user_id ? 'self' : 'other';
    const head = element(doc, 'header', 'av-comment-head');
    const time = doc.createElement('time');
    time.className = 'av-time';
    time.dateTime = comment.created_at;
    time.textContent =
      context.timeZone === undefined
        ? comment.created_at
        : (formatDateTime(comment.created_at, context.timeZone) ?? comment.created_at);
    head.append(element(doc, 'h4', 'av-subheading', comment.author_name), time);
    const body = element(doc, 'div', 'av-body');
    body.append(sanitizeHtml(comment.comment, { origin, doc }));
    article.append(head, body);
    for (const file of comment.attachments ?? []) {
      const link = element(doc, 'a', 'av-file', file.display_name);
      const url = submissionFileUrl(details, context, file.id);
      url.searchParams.set('comment_id', comment.id);
      link.setAttribute('href', url.href);
      article.append(link);
    }
    node.append(article);
  }
  if (!comments.length) node.append(element(doc, 'p', 'av-empty', 'No comments.'));
  return node;
}

/** The files the student handed in. They open in the file pane (decision 25). */
export function renderFiles(details: AssignmentDetails, context: RenderContext): HTMLElement {
  const { doc } = context;
  const node = section(doc, 'av-files', 'Your files');
  const files = details.submission.attachments ?? [];
  if (files.length === 0) {
    node.append(element(doc, 'p', 'av-empty', 'No files.'));
    return node;
  }
  const list = element(doc, 'ul', 'av-file-list');
  for (const file of files) {
    const item = doc.createElement('li');
    const link = element(doc, 'a', 'av-file', file.display_name);
    link.setAttribute('href', submissionFileUrl(details, context, file.id).href);
    item.append(link);
    list.append(item);
  }
  node.append(list);
  return node;
}
