import { isCommentTab } from '../model';

const ID = /^[1-9][0-9]{0,19}(?:~[1-9][0-9]{0,19})?$/;

export interface FileLinks {
  /** The file bytes on the saved Canvas, by the file id alone. */
  download: string;
  /** The Canvas page of the file, or `null` for a comment attachment, which has no such page. */
  canvas: string | null;
}

/**
 * The two links of a file card. Both stay on the saved Canvas and come from the file id and the
 * course id alone, never from a query: an address with a `verifier` would open the file for any
 * session, and these links open in a tab without any check of the extension. The one exception is
 * the error card, which shows the address that the student clicked, as the page shows it. A
 * course id that is not an id is left out. A comment attachment downloads from its own submission route.
 */
export function fileLinks(
  origin: string,
  fileId: string,
  courseId: string | null | undefined,
): FileLinks | null {
  if (isCommentTab(fileId)) return { download: new URL(fileId, origin).href, canvas: null };
  if (!ID.test(fileId)) return null;
  const course = typeof courseId === 'string' && ID.test(courseId) ? courseId : null;
  const page = new URL(course ? `/courses/${course}/files/${fileId}` : `/files/${fileId}`, origin);
  const download = new URL(`/files/${fileId}/download`, origin);
  // Canvas shows a text or HTML file in the tab unless this parameter asks for the file.
  download.searchParams.set('download_frd', '1');
  return { download: download.href, canvas: page.href };
}

/**
 * The address that the pane reads the bytes from. The `url` of the file record on the saved
 * Canvas stays as it is, with its query. Any other address is replaced by the download path of
 * the file id. Only a read that the token check of the background guards may use this address;
 * a link that the student can click never does (`fileLinks`).
 */
export function readAddress(
  origin: string,
  fileId: string,
  url: string | undefined,
): string | null {
  const links = fileLinks(origin, fileId, null);
  if (links === null) return null;
  if (typeof url === 'string' && url !== '' && !isCommentTab(fileId)) {
    try {
      const candidate = new URL(url, origin);
      if (candidate.origin === new URL(origin).origin) return candidate.href;
    } catch {
      // The standard path stays.
    }
  }
  return links.download;
}

/** The address when it is on the saved Canvas, and `null` for any other address or none. */
export function sameCanvasAddress(origin: string, address: string | undefined): string | null {
  if (address === undefined) return null;
  try {
    const url = new URL(address);
    return url.origin === new URL(origin).origin ? url.href : null;
  } catch {
    return null;
  }
}
