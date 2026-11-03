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
const ID = /^[1-9][0-9]{0,19}$/;
const FILE = /^\/(?:courses\/[1-9][0-9]*\/)?files\/([1-9][0-9]*)(?:\/(?:download|preview))?$/;
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
  const file = FILE.exec(url.pathname);
  if (file?.[1] && ID.test(file[1])) return { fileId: file[1] };
  // Canvas links a submission attachment as `/courses/:id/assignments/:id/submissions/:id?download=:file`.
  // A comment attachment adds `comment_id`. It is a file of someone else, so it keeps its action.
  const download = url.searchParams.get('download');
  if (
    download !== null &&
    !url.searchParams.has('comment_id') &&
    ID.test(download) &&
    /^\/courses\/[1-9][0-9]*\/assignments\/[1-9][0-9]*\/(?:submissions\/[1-9][0-9]*|anonymous_submissions\/[A-Za-z0-9]+)$/.test(
      url.pathname,
    )
  )
    return { fileId: download };
  const module = /^\/courses\/([1-9][0-9]*)\/modules\/items\/([1-9][0-9]*)$/.exec(url.pathname);
  if (module?.[1] && module[2] && moduleId && ID.test(moduleId))
    return { courseId: module[1], moduleId, itemId: module[2] };
  return null;
}
/** The course of a file link such as `/courses/12/files/42`, or `null` when the link has none. */
export function courseOfLink(href: string, origin: string): string | null {
  try {
    const url = new URL(href, origin);
    if (url.origin !== origin) return null;
    return /^\/courses\/([1-9][0-9]{0,19})\/(?:files|modules)\//.exec(url.pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}
export function validRequest(value: unknown): value is string {
  return typeof value === 'string' && (ID.test(value) || FILE.test(value));
}
export function normalizeWidth(value: unknown, viewportWidth = 1920): number {
  const limit = Math.max(360, Math.floor(viewportWidth * 0.7));
  const width = typeof value === 'number' && Number.isFinite(value) ? value : 480;
  return Math.round(Math.max(360, Math.min(limit, width)));
}
export function openFile(state: Tabs, id: string): Tabs {
  if (!ID.test(id)) return state;
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
  const ids = Array.isArray(raw.ids)
    ? [...new Set(raw.ids.filter((id) => typeof id === 'string' && ID.test(id)))].slice(0, 8)
    : [];
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
    /^\/courses\/[1-9][0-9]*\/assignments\/[1-9][0-9]*\/?$/.test(pagePath) &&
    link.closest(SUBMISSION_FILES) !== null &&
    link.closest(NOT_SUBMISSION_FILES) === null &&
    fileTarget(href, origin) !== null
  );
}

/** The submission details page, and the address of the frame in it that lists the files. */
const SUBMISSION_PAGE =
  /^\/courses\/[1-9][0-9]*\/assignments\/[1-9][0-9]*\/(?:submissions\/[1-9][0-9]*|anonymous_submissions\/[A-Za-z0-9]+)\/?$/;
export function isSubmissionPage(pagePath: string): boolean {
  return SUBMISSION_PAGE.test(pagePath);
}

/**
 * The file of a link in the files list of the submission details frame, or `null` when the link
 * is not one of the student's own files. Canvas draws that list as `table.file-upload-submission-table`
 * in the frame `#preview_frame`, with the links `a.file-upload-submission-info__link`. The
 * "Preview" button of the same row (`a.modal_preview_link`) opens the annotated copy, so it keeps
 * its action. Comment attachments are not in this frame, and they never match.
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
  return target !== null && 'fileId' in target ? target : null;
}

/** Whether a value is the id of a file. */
export function isFileId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value);
}
