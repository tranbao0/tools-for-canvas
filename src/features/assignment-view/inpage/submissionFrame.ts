/**
 * What the Submission Details page may take from its same-origin frame `#preview_frame` (design
 * decision 26, item 5). The frame is a helper: the files, their sizes, their scores and their
 * session addresses come from the details (`files.ts`), and the view never waits for the frame.
 *
 * The frame refines two marks of a file, when it can be read: the label of the preview button
 * ("View Feedback" or "Preview") and the unread mark, which Canvas draws in
 * `tr.file-upload-submission` of `table.file-upload-submission-table`
 * (`app/views/submissions/show_preview.html.erb`). It also tells whether Canvas's script drew a
 * report in a `td.asset-report-status-container`, which is an LTI 1.3 asset processor report that
 * the details do not hold. A frame that cannot be read, or that has other markup, gives nothing.
 */
import { fileTarget, isFileId } from '../../file-viewer/model';
import { normalizeCanvasId } from '../../../shared/canvas/ids';
import { sameSubmissionPath, type FeedbackLabel, type FrameHint } from './files';

/**
 * What the frame holds, read after it has loaded:
 * - `pending`: it does not show the preview page yet, such as the blank page before the load.
 * - `failed`: it cannot be read, such as a frame that went to another origin.
 * - `ready`: the hints of the file rows, by decimal global file id, and whether a report of an
 *   asset processor shows.
 */
export type FrameRead =
  | { state: 'pending' }
  | { state: 'failed' }
  | { state: 'ready'; hints: Map<string, FrameHint>; assetReports: boolean };

const LABELS: ReadonlySet<string> = new Set(['View Feedback', 'Preview']);

function trimmed(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

/** Whether a cell holds anything that Canvas drew: text, a link, an image or an icon. */
function hasContent(cell: Element): boolean {
  return (
    (cell.textContent ?? '').trim() !== '' ||
    cell.querySelector('a,img,svg,i,[class*=score]') !== null
  );
}

/** The hint of one row, or `null` when the row is not a file row of this page with one button. */
function hintOf(
  row: Element,
  origin: string,
  pagePath: string,
): { id: string; hint: FrameHint } | null {
  const link = row.querySelector('a.file-upload-submission-info__link');
  const href = link?.getAttribute('href');
  const target = href == null ? null : fileTarget(href, origin);
  if (
    href == null ||
    target === null ||
    !('fileId' in target) ||
    !isFileId(target.fileId) ||
    !sameSubmissionPath(new URL(href, origin).pathname, pagePath)
  )
    return null;
  const buttons = row.querySelectorAll('a.modal_preview_link');
  const label = buttons.length === 1 ? trimmed(buttons[0]!.textContent) : '';
  if (!LABELS.has(label)) return null;
  return {
    id: normalizeCanvasId(target.fileId),
    hint: {
      label: label as FeedbackLabel,
      unread: row.querySelector('.submission_annotation.unread_indicator') !== null,
    },
  };
}

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
    const hints = new Map<string, FrameHint>();
    for (const row of doc.querySelectorAll(
      'table.file-upload-submission-table tr.file-upload-submission',
    )) {
      const found = hintOf(row, origin, pagePath);
      if (found !== null && !hints.has(found.id)) hints.set(found.id, found.hint);
    }
    let assetReports = false;
    for (const cell of doc.querySelectorAll('td.asset-report-status-container')) {
      if (hasContent(cell)) assetReports = true;
    }
    return { state: 'ready', hints, assetReports };
  } catch {
    return { state: 'failed' };
  }
}
