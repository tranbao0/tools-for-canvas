/**
 * The data of the file access check (design decision 23). Every value here is already redacted:
 * hosts and structural paths, counts, statuses and media types. None holds a query string, a
 * token, a name or a file name.
 */
import type { FileProbeResult } from '../../shared/canvas/fileFetch';

/** The kinds of file link and file element that the page scan counts. */
export const SCAN_KINDS = [
  'instructure_file_link',
  'files_href',
  'preview_button',
  'module_file_item',
  'submission_attachment',
] as const;

export type ScanKind = (typeof SCAN_KINDS)[number];

export interface KindSummary {
  kind: ScanKind;
  count: number;
  /** A redacted path of the first element of this kind that has a link, or `null`. */
  sample: string | null;
  /** Up to three distinct shapes of the elements: the tag, the class names and the `data-` names. */
  hooks: string[];
}

export interface ScanSummary {
  /** The redacted path of the Canvas page that was scanned. */
  pagePath: string;
  kinds: KindSummary[];
  /** The id of the first file the scan found, or `null`. */
  fileId: string | null;
  fileIdKind: ScanKind | null;
  /** The content of the page's meta tag for the content security policy, redacted, or `null`. */
  metaCsp: string | null;
}

export interface ApiResult {
  /** The HTTP status, or `null` when the request failed before an answer. */
  status: number | null;
  /** The error kind when the request failed before an answer. */
  error: string | null;
  /** The `content-type` header of the answer. */
  contentType: string | null;
  size: number | null;
  /** The `content-type` field of the file. */
  fileContentType: string | null;
  hasUrl: boolean;
  hasPreviewUrl: boolean;
  /** The host and redacted path of `url`, and whether it is on the Canvas origin. */
  url: { host: string; path: string; sameOrigin: boolean } | null;
  previewUrl: { host: string; path: string; sameOrigin: boolean } | null;
}

export interface FrameResult {
  /** The scheme of the probe page address, such as `chrome-extension`. */
  scheme: string | null;
  /** Whether the probe page answered the handshake with the right nonce. */
  handshake: boolean;
  /** Whether the iframe fired its load event. */
  loadEvent: boolean;
  /**
   * Whether the answer came from the extension origin while the iframe address had another
   * origin, as it does when the resource has a dynamic address.
   */
  dynamicAddress: boolean;
  ms: number;
  error: string | null;
}

export interface HeadResult {
  /** The redacted path of the page that was asked. */
  path: string;
  status: number | null;
  error: string | null;
  csp: string | null;
  cspReportOnly: string | null;
}

export type FileIdSource = 'page' | 'pasted';

export interface CheckResults {
  scan: ScanSummary | null;
  scanError: string | null;
  fileSource: FileIdSource | null;
  api: ApiResult | null;
  background: FileProbeResult | null;
  extensionPage: FileProbeResult | null;
  frame: FrameResult | null;
  head: HeadResult | null;
  /** Steps that did not run or failed, as short text with no addresses. */
  notes: string[];
}

export interface ReportEnvironment {
  browser: string;
  extensionVersion: string;
  canvasHost: string;
  date: string;
}
