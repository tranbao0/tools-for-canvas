/**
 * What the Submission Details page may take from its same-origin frame `#preview_frame` (design
 * decision 26, item 5). The frame is a helper: the files, their sizes, their scores and their
 * session addresses come from the details (`files.ts`), and the view does not wait for the frame,
 * except for a file whose session address failed the check.
 *
 * The frame tells three things about a file, when it can be read. The first is whether Canvas draws
 * a preview button in its row, whatever the button says: Canvas writes the label in the language of
 * the student. Its text is the label of the view's button, and the unread mark, which Canvas draws
 * in `tr.file-upload-submission` of `table.file-upload-submission-table`
 * (`app/views/submissions/show_preview.html.erb`), is read whatever the label says. The third is
 * the session address of the button (`data-canvadoc_session_url`), which serves a file whose
 * details have no usable address. The frame also tells whether Canvas's script drew a report in a
 * `td.asset-report-status-container`, which is an LTI 1.3 asset processor report that the details
 * do not hold. A frame that cannot be read, or that has other markup, gives nothing.
 */
import { fileTarget, isFileId } from '../../file-viewer/model';
import { normalizeCanvasId } from '../../../shared/canvas/ids';
import { sameSubmissionPath, sessionUrl, type FrameHint } from './files';

/**
 * What the frame holds, read after it has loaded:
 * - `pending`: it does not show the preview page yet, such as the blank page before the load.
 * - `failed`: it cannot be read, such as a frame that went to another origin.
 * - `ready`: the hints of the file rows that have a preview button, by decimal global file id, and
 *   whether a report of an asset processor shows.
 */
export type FrameRead =
  | { state: 'pending' }
  | { state: 'failed' }
  | { state: 'ready'; hints: Map<string, FrameHint>; assetReports: boolean };

/** The longest label of a button that the view takes over. */
const MAX_LABEL = 40;

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

/**
 * The hint of one row, or `null` when the row is not a file row of this page with a preview button.
 * With one button, the hint holds its label and session address. With more, the row still has a
 * button, but the view takes no label or session from an unclear choice.
 */
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
  if (buttons.length === 0) return null;
  const only = buttons.length === 1 ? buttons.item(0) : null;
  const label = only === null ? '' : trimmed(only.textContent);
  return {
    id: normalizeCanvasId(target.fileId),
    hint: {
      label: label !== '' && label.length <= MAX_LABEL ? label : null,
      unread: row.querySelector('.submission_annotation.unread_indicator') !== null,
      session:
        only === null ? null : sessionUrl(only.getAttribute('data-canvadoc_session_url'), origin),
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
    if (!sameSubmissionPath(shown.pathname, pagePath)) return { state: 'pending' };
    // Index loops, because a Firefox content script cannot iterate every list of a page.
    const cells = doc.querySelectorAll('td.asset-report-status-container');
    // The preview page has a files table or a report cell, whatever parameters its address holds.
    // Canvas writes `preview=1` there today, and the view does not depend on that parameter.
    if (
      shown.searchParams.get('preview') !== '1' &&
      cells.length === 0 &&
      doc.querySelector('table.file-upload-submission-table') === null
    )
      return { state: 'pending' };
    const hints = new Map<string, FrameHint>();
    const rows = doc.querySelectorAll(
      'table.file-upload-submission-table tr.file-upload-submission',
    );
    for (let index = 0; index < rows.length; index += 1) {
      const found = hintOf(rows.item(index), origin, pagePath);
      if (found !== null && !hints.has(found.id)) hints.set(found.id, found.hint);
    }
    let assetReports = false;
    for (let index = 0; index < cells.length; index += 1) {
      if (hasContent(cells.item(index))) assetReports = true;
    }
    return { state: 'ready', hints, assetReports };
  } catch {
    return { state: 'failed' };
  }
}
