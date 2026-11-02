import { sanitizeHtml } from '../../shared/ui/sanitize';
import type { AssignmentDetails } from './protocol';

/** Builds inert content nodes for the shadow root of an expanded assignment. */
export function renderRubric(details: AssignmentDetails, doc: Document): HTMLElement {
  const section = doc.createElement('section');
  const heading = doc.createElement('h3');
  heading.textContent = 'Rubric';
  section.append(heading);
  const hidePoints = details.assignment.rubric_settings?.hide_points === true;
  for (const criterion of details.assignment.rubric ?? []) {
    const group = doc.createElement('section');
    const title = doc.createElement('h4');
    title.textContent = criterion.description;
    group.append(title);
    if (criterion.long_description) {
      const description = doc.createElement('p');
      description.textContent = criterion.long_description;
      group.append(description);
    }
    const assessment = details.submission.rubric_assessment?.[criterion.id];
    const ratings = doc.createElement('ul');
    for (const rating of criterion.ratings) {
      const item = doc.createElement('li');
      item.textContent = `${rating.description}${hidePoints ? '' : ` (${rating.points} points)`}`;
      if (assessment?.rating_id === rating.id) {
        item.dataset['assessed'] = 'true';
        item.append(doc.createTextNode(' - Your assessment'));
      }
      if (rating.long_description) item.append(doc.createTextNode(`: ${rating.long_description}`));
      ratings.append(item);
    }
    group.append(ratings);
    if (assessment !== undefined) {
      const result = doc.createElement('p');
      result.textContent =
        hidePoints || assessment.points === undefined
          ? 'Assessed'
          : `Your points: ${assessment.points} / ${criterion.points}`;
      group.append(result);
      if (assessment.comments) {
        const comment = doc.createElement('p');
        comment.textContent = assessment.comments;
        group.append(comment);
      }
    }
    section.append(group);
  }
  if (!details.assignment.rubric?.length) section.append(doc.createTextNode('No rubric.'));
  return section;
}

/** Includes student comments in their own section without inferring the roles of other authors. */
export function renderComments(
  details: AssignmentDetails,
  context: { origin: string; courseId: string; doc: Document },
): HTMLElement {
  const { doc, origin, courseId } = context;
  const section = doc.createElement('section');
  const heading = doc.createElement('h3');
  heading.textContent = 'Comments';
  section.append(heading);
  const comments = [...(details.submission.submission_comments ?? [])].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  );
  for (const comment of comments) {
    const article = doc.createElement('article');
    article.dataset['author'] = comment.author_id === details.submission.user_id ? 'self' : 'other';
    const author = doc.createElement('h4');
    author.textContent = comment.author_name;
    const time = doc.createElement('time');
    time.dateTime = comment.created_at;
    time.textContent = comment.created_at;
    const body = doc.createElement('div');
    body.append(sanitizeHtml(comment.comment, { origin, doc }));
    article.append(author, time, body);
    for (const file of comment.attachments ?? []) {
      const link = doc.createElement('a');
      link.textContent = file.display_name;
      const path = `/courses/${encodeURIComponent(courseId)}/assignments/${encodeURIComponent(details.assignment.id)}/submissions/${encodeURIComponent(details.submission.user_id)}`;
      const url = new URL(path, origin);
      url.searchParams.set('download', file.id);
      url.searchParams.set('comment_id', comment.id);
      link.href = url.href;
      article.append(link);
    }
    section.append(article);
  }
  if (!comments.length) section.append(doc.createTextNode('No comments.'));
  return section;
}
