import { MAX_FILE_BYTES } from '../../../shared/canvas/fileBytes';
import { t } from '../../../shared/ui/i18n';
import type { FileIconKind } from '../../../shared/ui/icons';
import { playerType } from './player';

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** A file size in units of 1024 bytes, such as "265 KB" or "1.5 MB". */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  let value = bytes;
  let unit = 0;
  while (unit < UNITS.length - 1 && Math.round(value) >= 1024) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit > 0 && value < 10 ? 1 : 0;
  const text = value.toFixed(digits).replace(/\.0$/, '');
  return `${text} ${UNITS[unit]}`;
}

/** Whether the viewer shows the file as a PDF. The content type decides, not the name. */
export function isPdf(contentType: string): boolean {
  return contentType.toLowerCase().split(';')[0]?.trim() === 'application/pdf';
}

/**
 * Whether the pane has a viewer that draws the file: a PDF or a passive format with a player, and
 * a file that the pane reads in full (`MAX_FILE_BYTES`). Any other file gets the card with a note,
 * Download and Open in Canvas.
 */
export function canShow(contentType: string, name: string, size: number): boolean {
  return (
    (isPdf(contentType) || playerType(contentType, name) !== null) &&
    !(Number.isFinite(size) && size > MAX_FILE_BYTES)
  );
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : '';
}

const OFFICE = {
  word: ['doc', 'docx', 'dotx', 'odt', 'rtf'],
  powerpoint: ['ppt', 'pptx', 'ppsx', 'odp'],
  excel: ['xls', 'xlsx', 'csv', 'ods'],
} as const;

/** The icon kind of a file, from its content type and then from the end of its name. */
export function fileKind(contentType: string, name: string): FileIconKind {
  const type = contentType.toLowerCase().split(';')[0]?.trim() ?? '';
  const extension = extensionOf(name);
  if (type === 'application/pdf' || extension === 'pdf') return 'pdf';
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('video/')) return 'video';
  for (const kind of ['word', 'powerpoint', 'excel'] as const) {
    if ((OFFICE[kind] as readonly string[]).includes(extension)) return kind;
  }
  if (type.includes('wordprocessingml') || type === 'application/msword') return 'word';
  if (type.includes('presentationml') || type === 'application/vnd.ms-powerpoint')
    return 'powerpoint';
  if (type.includes('spreadsheetml') || type === 'application/vnd.ms-excel') return 'excel';
  return 'document';
}

/** The type shown on the file card, such as "PDF" or "Image". */
export function typeLabel(contentType: string, name: string): string {
  switch (fileKind(contentType, name)) {
    case 'pdf':
      return 'PDF';
    case 'image':
      return t('fileTypeImage');
    case 'audio':
      return t('fileTypeAudio');
    case 'video':
      return t('fileTypeVideo');
    case 'word':
      return t('fileTypeWord');
    case 'powerpoint':
      return t('fileTypePowerPoint');
    case 'excel':
      return t('fileTypeExcel');
    case 'document': {
      if (contentType.toLowerCase().startsWith('text/')) return t('fileTypeText');
      const extension = extensionOf(name);
      return /^[a-z0-9]{1,5}$/.test(extension) ? extension.toUpperCase() : t('fileTypeOther');
    }
  }
}
