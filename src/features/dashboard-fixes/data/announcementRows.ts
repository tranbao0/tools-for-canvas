/**
 * The rows of the Announcements widget: the background turns what Canvas sent (a GraphQL node or
 * a REST topic) into one shape with a limit on every text, so a hostile or huge post cannot fill
 * a message or a page. See docs/design.md, decision 22.
 */
import { isCanvasId } from '../../../shared/canvas/ids';
import type { AnnouncementPageNode, AnnouncementTopic } from '../../../shared/canvas/types';
import type { AnnouncementListRow } from '../protocol';

/** The longest message that a row carries. The row shows a snippet, and the search reads it. */
export const MAX_LIST_MESSAGE_CHARS = 4_000;
const MAX_TITLE_CHARS = 1_000;
const MAX_NAME_CHARS = 300;
const MAX_URL_CHARS = 2_000;

function limited(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

/**
 * The paths on the Canvas origin that an image may load: files, equation images and assets. It is
 * the rule of the sanitizer (`CANVAS_IMAGE_PATH` in src/shared/ui/sanitize.ts). Any other Canvas
 * page as an image address would be a GET of that page, and a GET of a topic page marks the topic
 * as read, so such an avatar address is dropped.
 */
const CANVAS_IMAGE_PATH =
  /^\/(?:(?:courses|groups|users|accounts)\/\d+(?:~\d+)?\/files\/|files\/|equation_images\/|images\/|dist\/)/;

/**
 * The address of an image as an absolute http or https address, or `null`. An address on the Canvas
 * origin must be a file, an equation image or an asset path.
 */
export function webAddress(value: unknown, origin: string): string | null {
  if (typeof value !== 'string' || value === '' || value.length > MAX_URL_CHARS) return null;
  try {
    const url = new URL(value, origin);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.origin === new URL(origin).origin && !CANVAS_IMAGE_PATH.test(url.pathname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function instant(value: unknown): string | null {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null;
}

/** A row of the GraphQL connection, or `null` when its ids are not Canvas ids. */
export function rowFromNode(
  node: AnnouncementPageNode,
  origin: string,
): AnnouncementListRow | null {
  if (!isCanvasId(node.id) || !isCanvasId(node.courseId)) return null;
  return {
    id: node.id,
    courseId: node.courseId,
    courseName: limited(node.courseName, MAX_NAME_CHARS),
    title: limited(node.title, MAX_TITLE_CHARS),
    postedAt: instant(node.createdAt),
    author: node.authorName === null ? null : limited(node.authorName, MAX_NAME_CHARS),
    avatarUrl: webAddress(node.avatarUrl, origin),
    read: node.read,
    message: limited(node.message, MAX_LIST_MESSAGE_CHARS),
  };
}

const COURSE_CODE = /^course_(\d+(?:~\d+)?)$/;

/**
 * A row of the REST list. A topic that names no wanted course, or has no valid id, drops out, so
 * nothing from another context gets in.
 */
export function rowFromTopic(
  topic: AnnouncementTopic,
  courses: ReadonlyMap<string, string>,
  origin: string,
): AnnouncementListRow | null {
  const courseId = COURSE_CODE.exec(topic.context_code ?? '')?.[1];
  if (courseId === undefined || !courses.has(courseId) || !isCanvasId(topic.id)) return null;
  const author = topic.user_name ?? topic.author?.display_name ?? null;
  return {
    id: topic.id,
    courseId,
    courseName: limited(courses.get(courseId), MAX_NAME_CHARS),
    title: limited(topic.title, MAX_TITLE_CHARS),
    postedAt: instant(topic.posted_at),
    author: author === null ? null : limited(author, MAX_NAME_CHARS),
    avatarUrl: webAddress(topic.author?.avatar_image_url, origin),
    read: topic.read_state === 'read',
    message: limited(topic.message, MAX_LIST_MESSAGE_CHARS),
  };
}
