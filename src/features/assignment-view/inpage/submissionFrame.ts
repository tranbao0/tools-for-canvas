/**
 * What the Submission Details page keeps in its same-origin frame `#preview_frame`: the rows of
 * the files list (design decision 26, "Submission Details page").
 *
 * Canvas draws the list as `tr.file-upload-submission` in `table.file-upload-submission-table`
 * (`app/views/submissions/show_preview.html.erb`). A row has the file link, the size text and,
 * for a document that Canvas can preview, a `a.modal_preview_link` button whose data attributes
 * carry the signed address of the DocViewer session.
 */
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
    const keys = [...url.searchParams.keys()].sort();
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

function samePath(path: string, page: string): boolean {
  return path.replace(/\/$/, '') === page.replace(/\/$/, '');
}

/**
 * The files list of the frame, or `null` when the frame does not show the page yet or cannot be
 * read. An empty list means that the page has loaded and has no file rows. A link counts only
 * when it is a file of the submission of this page.
 */
export function readFrameFiles(
  frame: HTMLIFrameElement,
  origin: string,
  pagePath: string,
): FrameFile[] | null {
  try {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    if (!win || !doc || doc.readyState !== 'complete') return null;
    const shown = new URL(win.location.href);
    if (
      shown.origin !== origin ||
      !samePath(shown.pathname, pagePath) ||
      shown.searchParams.get('preview') !== '1'
    )
      return null;
    const files: FrameFile[] = [];
    for (const row of doc.querySelectorAll(
      'table.file-upload-submission-table tr.file-upload-submission',
    )) {
      const link = row.querySelector('a.file-upload-submission-info__link');
      const href = link?.getAttribute('href');
      if (!link || href == null) continue;
      const target = fileTarget(href, origin);
      if (
        target === null ||
        !('fileId' in target) ||
        !isFileId(target.fileId) ||
        !samePath(new URL(href, origin).pathname, pagePath)
      )
        continue;
      const preview = row.querySelector(
        'td.file-upload-submission-attachment a.modal_preview_link',
      );
      files.push({
        fileId: target.fileId,
        name: trimmed(link.textContent),
        size:
          trimmed(row.querySelector('.file-upload-submission-info__filesize')?.textContent, 20) ||
          null,
        feedbackLabel: preview ? trimmed(preview.textContent, 40) || null : null,
        unread: row.querySelector('.submission_annotation.unread_indicator') !== null,
        sessionUrl: sessionUrl(preview?.getAttribute('data-canvadoc_session_url') ?? null, origin),
      });
    }
    return files;
  } catch {
    return null;
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
