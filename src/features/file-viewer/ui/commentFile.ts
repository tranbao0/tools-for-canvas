import { fetchFileBytes } from '../../../shared/canvas/fileBytes';
import { t } from '../../../shared/ui/i18n';
import type { PaneFile } from './FileCard';
import { sniffRaster } from './player';

/** The bytes at the start of a file that show its format. */
const HEAD_BYTES = 16;
const GENERIC = new Set(['', 'application/octet-stream', 'binary/octet-stream']);

/**
 * The content type of a file whose record the pane cannot read: the type of the answer, and when
 * the answer gives none (or only a generic one), the format that the first bytes show.
 */
export function sniffContentType(header: string | null, head: Uint8Array): string {
  const type = header?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!GENERIC.has(type)) return type;
  if (String.fromCharCode(...head.subarray(0, 5)) === '%PDF-') return 'application/pdf';
  return sniffRaster(head) ?? (type || 'application/octet-stream');
}

/**
 * The record of a comment attachment. The files API may refuse a student the comment attachment
 * of a teacher, so the pane reads the file through its submission route, the route that Canvas
 * links. The type comes from the answer of that route and from the first bytes. The name is the
 * text of the link. The size is not known before the full read.
 */
export async function loadCommentFile(options: {
  tabId: string;
  name: string | undefined;
  origin: string;
  confirm: () => Promise<boolean>;
  fetchImpl?: typeof fetch;
}): Promise<PaneFile> {
  const url = new URL(options.tabId, options.origin).href;
  let header: string | null = null;
  const head = await fetchFileBytes({
    origin: options.origin,
    url,
    truncateAt: HEAD_BYTES,
    confirm: options.confirm,
    onHeaders: (headers) => {
      header = headers.get('content-type');
    },
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
  return {
    name: options.name ?? t('fileCommentAttachment'),
    contentType: sniffContentType(header, head),
    size: Number.NaN,
    url,
    courseId: null,
  };
}
