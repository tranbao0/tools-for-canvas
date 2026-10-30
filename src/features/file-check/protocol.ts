/**
 * The messages of the file access check between its page and the background. See docs/design.md,
 * decision 23. Only extension pages may send them. The one exception is the open message, which
 * the in-page settings send.
 */
import { isCanvasId } from '../../shared/canvas/ids';
import type { ApiResult, FrameResult, HeadResult, ScanSummary } from './types';
import type { FileProbeResult } from '../../shared/canvas/fileFetch';

/** Opens the check page. Sent by the settings in the panel, the settings page and the in-page list. */
export interface FileCheckOpenMessage {
  type: 'weekrow:file-check-open';
}

/** Scans the Canvas tab the student used last. The reply is a `FileCheckScanReply`. */
export interface FileCheckScanMessage {
  type: 'weekrow:file-check-scan';
}

export interface FileCheckScanReply {
  tabId: number | null;
  scan: ScanSummary | null;
  error: string | null;
}

/** Asks for the file API answer and the background fetch. The reply is a `FileCheckFileReply`. */
export interface FileCheckFileMessage {
  type: 'weekrow:file-check-file';
  fileId: string;
}

export interface FileCheckFileReply {
  api: ApiResult;
  background: FileProbeResult | null;
  /** The address to fetch. It can hold a verifier, so only the extension page code may use it. */
  url: string | null;
}

/** Runs the frame probe and the header check in a tab. The reply is a `FileCheckFrameReply`. */
export interface FileCheckFrameMessage {
  type: 'weekrow:file-check-frame';
  tabId: number;
}

export interface FileCheckFrameReply {
  frame: FrameResult;
  head: HeadResult;
}

export type FileCheckMessage =
  FileCheckOpenMessage | FileCheckScanMessage | FileCheckFileMessage | FileCheckFrameMessage;

/** The message the probe page posts to its parent. */
export const PROBE_MESSAGE_TYPE = 'weekrow:file-probe';

type Fields = Record<string, unknown>;

function hasType(value: unknown, type: string): value is Fields {
  return typeof value === 'object' && value !== null && (value as Fields)['type'] === type;
}

export function isFileCheckMessage(value: unknown): value is FileCheckMessage {
  if (typeof value !== 'object' || value === null) return false;
  switch ((value as Fields)['type']) {
    case 'weekrow:file-check-open':
    case 'weekrow:file-check-scan':
      return true;
    case 'weekrow:file-check-file':
      return isCanvasId((value as Fields)['fileId']);
    case 'weekrow:file-check-frame':
      return Number.isInteger((value as Fields)['tabId']);
    default:
      return false;
  }
}

export function isOpenMessage(value: unknown): value is FileCheckOpenMessage {
  return hasType(value, 'weekrow:file-check-open');
}
