import { normalizeCanvasId } from '../../shared/canvas/ids';
/** File identities and pane state contain no download addresses. */
/**
 * The attribute of a host that an extension panel draws into the Canvas page, with an open shadow
 * root. The pane takes a file link inside it, which the page would see only as a click on the host.
 */
export const PANEL_HOST_ATTRIBUTE = 'data-weekrow-panel';
export interface Tabs {
  ids: string[];
  active: string | null;
}
export type FileTarget =
  { fileId: string } | { courseId: string; moduleId: string; itemId: string };
const ID = /^[1-9][0-9]{0,19}(?:~[1-9][0-9]{0,19})?$/;
const ID_PART = '[1-9][0-9]{0,19}(?:~[1-9][0-9]{0,19})?';
// The submission of a comment attachment: a user id, or the anonymous id of an anonymous grading.
const SUBMISSION_PART = `(?:submissions/${ID_PART}|anonymous_submissions/[A-Za-z0-9]{1,64})`;
const SUBMISSION_ROUTE = new RegExp(
  `^/courses/(${ID_PART})/assignments/(${ID_PART})/(${SUBMISSION_PART})$`,
);
/**
 * The address of a comment attachment as the pane keeps it: the submission route of the saved
 * Canvas with its two numeric parameters in a fixed order. A student may read the comment
 * attachment of a teacher only through this route, so it is the tab id of the file. The id is
 * built from validated parts and matched again at every hop, so no other address gets in.
 */
const COMMENT_TAB = new RegExp(
  `^/courses/${ID_PART}/assignments/${ID_PART}/${SUBMISSION_PART}\\?comment_id=${ID_PART}&download=${ID_PART}$`,
);
/** The routes where Canvas pushes `?preview=`: the files, a folder of them, and a search. */
const PREVIEW_PAGE = new RegExp(`^/courses/${ID_PART}/files(?:/folder(?:/[^/]*)*|/search)?/?$`);
const FILE =
  /^\/(?:courses\/[1-9][0-9]{0,19}(?:~[1-9][0-9]{0,19})?\/)?files\/([1-9][0-9]{0,19}(?:~[1-9][0-9]{0,19})?)(?:\/(?:download|preview))?$/;
/**
 * A left click of the student with no modifier key. A script of the Canvas page can dispatch a
 * click on any link, and such an event is not trusted, so it never opens a file.
 */
export function plainClick(
  event: Pick<MouseEvent, 'isTrusted' | 'button' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>,
): boolean {
  return (
    event.isTrusted &&
    event.button === 0 &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    !event.metaKey
  );
}
/**
 * The element a click hit. A click inside the open shadow root of a panel host reaches the page as
 * a click on the host, so the real element comes from the path of the event. Any other shadow root
 * keeps its retargeted result.
 */
export function clickedElement(event: Pick<Event, 'target' | 'composedPath'>): Element | null {
  const target = event.target;
  if (!(target instanceof Element)) return null;
  if (!target.hasAttribute(PANEL_HOST_ATTRIBUTE)) return target;
  const inner = event.composedPath()[0];
  return inner instanceof Element && target.shadowRoot?.contains(inner) ? inner : target;
}
export function fileTarget(href: string, origin: string, moduleId?: string): FileTarget | null {
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  const preview = url.searchParams.get('preview');
  if (
    PREVIEW_PAGE.test(url.pathname) &&
    url.searchParams.getAll('preview').length === 1 &&
    preview !== null &&
    ID.test(preview)
  )
    return { fileId: preview };
  const file = FILE.exec(url.pathname);
  if (file?.[1] && ID.test(file[1])) return { fileId: file[1] };
  // Canvas links a submission attachment as `/courses/:id/assignments/:id/submissions/:id?download=:file`.
  // A comment attachment adds `comment_id`, and its tab id is that route (see `COMMENT_TAB`).
  const download = url.searchParams.get('download');
  const comments = url.searchParams.getAll('comment_id');
  const route = SUBMISSION_ROUTE.exec(url.pathname);
  if (
    download !== null &&
    url.searchParams.getAll('download').length === 1 &&
    ID.test(download) &&
    comments.length <= 1 &&
    route !== null
  ) {
    if (comments.length === 0) return { fileId: download };
    // The id is built from the checked parts, never from the address of the page.
    const tab = `/courses/${route[1]}/assignments/${route[2]}/${route[3]}?comment_id=${comments[0]}&download=${download}`;
    if (COMMENT_TAB.test(tab)) return { fileId: tab };
  }
  const module =
    /^\/courses\/([1-9][0-9]{0,19}(?:~[1-9][0-9]{0,19})?)\/modules\/items\/([1-9][0-9]{0,19}(?:~[1-9][0-9]{0,19})?)$/.exec(
      url.pathname,
    );
  if (module?.[1] && module[2] && moduleId && ID.test(moduleId))
    return { courseId: module[1], moduleId, itemId: module[2] };
  return null;
}
/** The longest address of a clicked link that the pane keeps. */
export const ADDRESS_LIMIT = 2000;

/**
 * The address of a file link that carries a `verifier` or a `location` parameter, or `undefined`
 * for any other link, another origin and an address that is too long. `fileTarget` drops these
 * parameters, so a file that Canvas shows only through them has no way out of an error card. The
 * pane keeps this address in memory for the "Open in Canvas" link of that card. It never reads it.
 */
export function keptAddress(href: string, origin: string): string | undefined {
  try {
    const url = new URL(href, origin);
    if (url.origin !== origin || url.href.length > ADDRESS_LIMIT) return undefined;
    return url.searchParams.has('verifier') || url.searchParams.has('location')
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

/** The course of a file link such as `/courses/12/files/42`, or `null` when the link has none. */
export function courseOfLink(href: string, origin: string): string | null {
  try {
    const url = new URL(href, origin);
    if (url.origin !== origin) return null;
    return (
      /^\/courses\/([1-9][0-9]{0,19}(?:~[1-9][0-9]{0,19})?)\/(?:files|modules)\//.exec(
        url.pathname,
      )?.[1] ?? null
    );
  } catch {
    return null;
  }
}
export function validRequest(value: unknown): value is string {
  return typeof value === 'string' && (ID.test(value) || FILE.test(value));
}
/** Whether a value names a tab: the id of a file, or the address of a comment attachment. */
export function isTabId(value: unknown): value is string {
  return typeof value === 'string' && (ID.test(value) || COMMENT_TAB.test(value));
}
/** Whether a tab id is a comment attachment, which the pane reads through its submission route. */
export function isCommentTab(value: string): boolean {
  return COMMENT_TAB.test(value);
}
/**
 * The name of a comment attachment from the text of its link: one line without control
 * characters, at most 200 characters. `undefined` when nothing is left.
 */
export function linkName(text: string | null): string | undefined {
  const name = (text ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trimStart()
    // The cut comes before the last trim, so a space at the cut does not stay.
    .slice(0, 200)
    .trimEnd();
  return name === '' ? undefined : name;
}
export function openFile(state: Tabs, id: string): Tabs {
  if (!isTabId(id)) return state;
  const ids = [...state.ids];
  if (!ids.includes(id)) {
    if (ids.length >= 8)
      ids.splice(
        ids.findIndex((entry) => entry !== state.active),
        1,
      );
    ids.push(id);
  }
  return { ids, active: id };
}
export function normalizeTabs(value: unknown): Tabs {
  if (typeof value !== 'object' || value === null) return { ids: [], active: null };
  const raw = value as Partial<Tabs>;
  const ids = Array.isArray(raw.ids) ? [...new Set(raw.ids.filter(isTabId))].slice(0, 8) : [];
  return {
    ids,
    active:
      typeof raw.active === 'string' && ids.includes(raw.active) ? raw.active : (ids[0] ?? null),
  };
}
/** Closes a tab. The tab that takes its place becomes active, or the one before it at the end. */
export function closeFile(state: Tabs, id: string): Tabs {
  const index = state.ids.indexOf(id);
  if (index < 0) return state;
  const ids = state.ids.filter((entry) => entry !== id);
  if (state.active !== id) return { ids, active: state.active };
  return { ids, active: ids[index] ?? ids[index - 1] ?? null };
}

/**
 * The place where Canvas lists the files that the student handed in on the assignment page: the
 * Submission section in the right column (`#right-side .details > .content`). The list on the
 * submission details page is in a frame, which the frame catcher handles (`frameFileTarget`).
 */
const SUBMISSION_FILES = '#right-side .details > .content';
/** Text that other people write and files that are not the student's own work. */
const NOT_SUBMISSION_FILES = '.description,.user_content,.comments,.comment,.comment_attachments';

/**
 * Whether a link with a `download` attribute is a file the student handed in. Canvas can mark
 * these as downloads, but the student needs to read them. A download button that a teacher puts in
 * the assignment description, or a comment attachment, keeps its normal action.
 */
export function catchesDownload(
  link: Element,
  href: string,
  origin: string,
  pagePath: string,
): boolean {
  return (
    /^\/courses\/[1-9][0-9]{0,19}(?:~[1-9][0-9]{0,19})?\/assignments\/[1-9][0-9]{0,19}(?:~[1-9][0-9]{0,19})?\/?$/.test(
      pagePath,
    ) &&
    link.closest(SUBMISSION_FILES) !== null &&
    link.closest(NOT_SUBMISSION_FILES) === null &&
    fileTarget(href, origin) !== null
  );
}

/** The submission details page, and the address of the frame in it that lists the files. */
const SUBMISSION_PAGE =
  /^\/courses\/[1-9][0-9]{0,19}(?:~[1-9][0-9]{0,19})?\/assignments\/[1-9][0-9]{0,19}(?:~[1-9][0-9]{0,19})?\/(?:submissions\/[1-9][0-9]{0,19}(?:~[1-9][0-9]{0,19})?|anonymous_submissions\/[A-Za-z0-9]+)\/?$/;
export function isSubmissionPage(pagePath: string): boolean {
  return SUBMISSION_PAGE.test(pagePath);
}

/** The Assignments list of a course, and a page of a course: `/courses/:id` and everything under it. */
const ASSIGNMENTS_LIST = new RegExp(`^/courses/(${ID_PART})/assignments/?$`);
const COURSE_PAGE = new RegExp(`^/courses/(${ID_PART})(?:/.*)?$`);

/** Whether a page path is the Assignments list of a course, which holds the assignment pane. */
export function isAssignmentsList(pagePath: string): boolean {
  return ASSIGNMENTS_LIST.test(pagePath);
}

/**
 * Whether a frame page is in the course of the Assignments list at `topPath`. The ids compare as
 * decimal global ids, because a shard id can be written in two forms.
 */
export function isPaneCoursePage(topPath: string, framePath: string): boolean {
  const list = ASSIGNMENTS_LIST.exec(topPath)?.[1];
  const own = COURSE_PAGE.exec(framePath)?.[1];
  return (
    list !== undefined && own !== undefined && normalizeCanvasId(list) === normalizeCanvasId(own)
  );
}

/**
 * Whether a frame page is a page that the assignment pane holds in a tab that shows the
 * Assignments list at `topPath`: a page of the same course with `content_only=1`. The pane loads
 * its frame with that parameter, and it loads every other page of the course that the frame
 * reaches (a graded discussion or quiz) with the parameter too.
 */
export function isPaneFramePage(topPath: string, framePath: string, frameSearch: string): boolean {
  return (
    isPaneCoursePage(topPath, framePath) &&
    new URLSearchParams(frameSearch).get('content_only') === '1'
  );
}

/**
 * The file of a link in a page of the assignment pane's frame (decision 25, item 11), or `null`
 * when the link is not a file link. It takes the links that the top frame takes (`fileTarget`)
 * and passes a file id only, because a comment attachment needs a route that the frame never
 * hands over. A link with a `download` attribute keeps its action, except a file that the student
 * handed in (`catchesDownload`). `href` is the address that the browser resolved for the link.
 */
export function paneFileTarget(
  link: Element,
  href: string,
  origin: string,
  pagePath: string,
): { fileId: string } | null {
  if (!link.matches('a[href]')) return null;
  if (link.hasAttribute('download') && !catchesDownload(link, href, origin, pagePath)) return null;
  const target = fileTarget(href, origin);
  return target !== null && 'fileId' in target && isFileId(target.fileId) ? target : null;
}

/**
 * The file of a link in the files list of the submission details frame, or `null` when the link
 * is not one of the student's own files. Canvas draws that list as `table.file-upload-submission-table`
 * in the frame `#preview_frame`, with the links `a.file-upload-submission-info__link`. The
 * "Preview" button of the same row (`a.modal_preview_link`) opens the annotated copy, so it keeps
 * its action. A comment attachment is in the top frame, and it never matches here.
 */
export function frameFileTarget(
  link: Element,
  href: string,
  origin: string,
  pagePath: string,
): { fileId: string } | null {
  if (
    !isSubmissionPage(pagePath) ||
    !link.matches('a.file-upload-submission-info__link') ||
    link.closest('.file-upload-submission-table') === null ||
    link.closest(NOT_SUBMISSION_FILES) !== null
  )
    return null;
  const target = fileTarget(href, origin);
  // The frame passes a file id on, which the pane reads through the files API. A comment
  // attachment is not one.
  return target !== null && 'fileId' in target && isFileId(target.fileId) ? target : null;
}

/** Whether a value is the id of a file. */
export function isFileId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value);
}
