/**
 * What the Submission Details page keeps in its same-origin frame `#preview_frame`: the rows of
 * the files list (design decision 26, "Submission Details page").
 *
 * Canvas draws the list as `tr.file-upload-submission` in `table.file-upload-submission-table`
 * (`app/views/submissions/show_preview.html.erb`). A row has the file link, the size text and,
 * for a document that Canvas can preview, a `a.modal_preview_link` button whose data attributes
 * carry the signed address of the DocViewer session.
 */
import { normalizeCanvasId } from '../../../shared/canvas/ids';
import { fileTarget, isFileId } from '../../file-viewer/model';
import type { AssignmentFile } from '../protocol';

/** The path of the session that Canvas gives for a previewable file (`Attachment#canvadoc_url`). */
const SESSION_PATH = '/api/v1/canvadoc_session';
const MAX_TEXT = 255;

export interface FrameFile {
  fileId: string;
  name: string;
  /** Canvas's own size text, such as "118 KB". */
  size: string | null;
  /** Canvas's own label of the preview button: "View Feedback" or "Preview". */
  feedbackLabel: string | null;
  /** Whether Canvas marks unread comments on the file. */
  unread: boolean;
  /** The checked address of the session. It is never put on the page. */
  sessionUrl: string | null;
}

/**
 * The address of a DocViewer session, or `null`. It must be on the saved Canvas, with the session
 * path and the two signed parameters `blob` and `hmac` once each, and no other parameter. The value
 * is signed for one student, so no other address is ever used.
 */
export function sessionUrl(value: string | null, origin: string): string | null {
  if (value === null || value === '') return null;
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || url.pathname !== SESSION_PATH || url.hash !== '') return null;
    // The list comes from the params object: a Firefox content script cannot spread `keys()`.
    const keys = [...url.searchParams].map(([key]) => key).sort();
    if (keys.length !== 2 || keys[0] !== 'blob' || keys[1] !== 'hmac') return null;
    if (!url.searchParams.get('blob') || !url.searchParams.get('hmac')) return null;
    return url.href;
  } catch {
    return null;
  }
}

function trimmed(value: string | null | undefined, max = MAX_TEXT): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** `/courses/:c/assignments/:a/submissions/:user`, each id plain or with a shard. */
const SUBMISSION_PATH =
  /^\/courses\/(\d+(?:~\d+)?)\/assignments\/(\d+(?:~\d+)?)\/submissions\/(\d+(?:~\d+)?)\/?$/;

/**
 * Whether two paths are the Submission Details page of the same course, assignment and user. The
 * page can write an id as `2~123` while the frame writes it as `20000000000123`, so the ids are
 * compared segment by segment as decimal global ids.
 */
export function sameSubmissionPath(a: string, b: string): boolean {
  const first = SUBMISSION_PATH.exec(a);
  const second = SUBMISSION_PATH.exec(b);
  if (!first || !second) return false;
  return [1, 2, 3].every((index) => {
    return normalizeCanvasId(first[index]!) === normalizeCanvasId(second[index]!);
  });
}

/** The marks of a similarity report in the file rows: Turnitin, VeriCite and plagiarism platforms. */
const SCORE_MARKS =
  '.turnitin_score_container,.turnitin_similarity_score,.vericite_score_container_caret';

/** Whether a cell holds anything that Canvas drew: text, a link, an image or an icon. */
function hasContent(cell: Element): boolean {
  return (
    (cell.textContent ?? '').trim() !== '' ||
    cell.querySelector('a,img,svg,[class*=score]') !== null
  );
}

/**
 * Whether the frame shows a similarity score or report link that the view would hide. Canvas draws
 * the originality cell with the page, and fills the report status cell with a script a moment later.
 */
function hasOriginality(doc: Document): boolean {
  for (const mark of doc.querySelectorAll(SCORE_MARKS)) {
    // A text entry is user content, and its markup is no report.
    if (mark.closest('#submission_preview,.user_content') === null) return true;
  }
  for (const cell of doc.querySelectorAll(
    'td.file-upload-submission-turnitin,td.asset-report-status-container',
  )) {
    if (hasContent(cell)) return true;
  }
  return false;
}

/**
 * What the frame holds, read after it has loaded:
 * - `pending`: it does not show the preview page yet, such as the blank page before the load.
 * - `failed`: it cannot be read, such as a frame that went to another origin.
 * - `ready`: the file rows, and what the view cannot show of the frame. `complete` is false when a
 *   file row does not match, a preview button has no usable session address, or a similarity report
 *   shows. `snapshot` is true when the frame holds an image, such as the snapshot of a URL.
 */
export type FrameRead =
  | { state: 'pending' }
  | { state: 'failed' }
  | { state: 'ready'; files: FrameFile[]; complete: boolean; snapshot: boolean };

export function readFrame(frame: HTMLIFrameElement, origin: string, pagePath: string): FrameRead {
  try {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    if (!win || !doc) return { state: 'failed' };
    if (doc.readyState !== 'complete') return { state: 'pending' };
    // The blank page that a frame shows before its first navigation.
    if (win.location.href === 'about:blank') return { state: 'pending' };
    const shown = new URL(win.location.href);
    if (shown.origin !== origin) return { state: 'failed' };
    if (!sameSubmissionPath(shown.pathname, pagePath) || shown.searchParams.get('preview') !== '1')
      return { state: 'pending' };
    const files: FrameFile[] = [];
    let complete = !hasOriginality(doc);
    for (const row of doc.querySelectorAll(
      'table.file-upload-submission-table tr.file-upload-submission',
    )) {
      const link = row.querySelector('a.file-upload-submission-info__link');
      const href = link?.getAttribute('href');
      const target = href == null ? null : fileTarget(href, origin);
      if (
        !link ||
        href == null ||
        target === null ||
        !('fileId' in target) ||
        !isFileId(target.fileId) ||
        !sameSubmissionPath(new URL(href, origin).pathname, pagePath)
      ) {
        complete = false;
        continue;
      }
      const preview = row.querySelector(
        'td.file-upload-submission-attachment a.modal_preview_link',
      );
      const session = sessionUrl(
        preview?.getAttribute('data-canvadoc_session_url') ?? null,
        origin,
      );
      // A button that the view cannot offer would hide the notes of the teacher.
      if (preview && session === null) complete = false;
      // Canvas's own handler reads `data-canvadoc_session_url`, so a button that the expected
      // selector missed, such as a renamed class, still hides the notes.
      for (const other of row.querySelectorAll('[data-canvadoc_session_url],.modal_preview_link')) {
        if (other !== preview) complete = false;
      }
      files.push({
        fileId: target.fileId,
        name: trimmed(link.textContent),
        size:
          trimmed(row.querySelector('.file-upload-submission-info__filesize')?.textContent, 20) ||
          null,
        feedbackLabel: preview ? trimmed(preview.textContent, 40) || null : null,
        unread: row.querySelector('.submission_annotation.unread_indicator') !== null,
        sessionUrl: session,
      });
    }
    return { state: 'ready', files, complete, snapshot: doc.querySelector('img') !== null };
  } catch {
    return { state: 'failed' };
  }
}

/** A size as Rails `number_to_human_size` writes it, for example "118 KB". */
export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? 'Byte' : 'Bytes'}`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length);
  const value = Number((bytes / 1024 ** exponent).toPrecision(3));
  return `${value} ${units[exponent - 1]}`;
}

/** The files of the details in the shape of the frame rows, for a frame that cannot be read. */
export function filesFromDetails(files: readonly AssignmentFile[]): FrameFile[] {
  return files.map((file) => ({
    fileId: file.id,
    name: file.display_name,
    size: file.size === undefined ? null : humanSize(file.size),
    feedbackLabel: null,
    unread: false,
    sessionUrl: null,
  }));
}
