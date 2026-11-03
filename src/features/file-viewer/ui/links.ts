import { isCommentTab } from '../model';

const ID = /^[1-9][0-9]{0,19}(?:~[1-9][0-9]{0,19})?$/;

export interface FileLinks {
  /** The file bytes on the saved Canvas. */
  download: string;
  /** The Canvas page of the file, or `null` for a comment attachment, which has no such page. */
  canvas: string | null;
}

/**
 * The two links of a file card. Both stay on the saved Canvas: a `url` from the file record that
 * points anywhere else is replaced by the standard download path. A course id that is not an id
 * is left out. A comment attachment downloads from its own submission route.
 */
export function fileLinks(
  origin: string,
  fileId: string,
  courseId: string | null | undefined,
  url: string | undefined,
): FileLinks | null {
  if (isCommentTab(fileId)) return { download: new URL(fileId, origin).href, canvas: null };
  if (!ID.test(fileId)) return null;
  let download = new URL(`/files/${fileId}/download`, origin);
  if (typeof url === 'string' && url !== '') {
    try {
      const candidate = new URL(url, origin);
      if (candidate.origin === new URL(origin).origin) download = candidate;
    } catch {
      // The standard path stays.
    }
  }
  const course = typeof courseId === 'string' && ID.test(courseId) ? courseId : null;
  const page = new URL(course ? `/courses/${course}/files/${fileId}` : `/files/${fileId}`, origin);
  return { download: download.href, canvas: page.href };
}
