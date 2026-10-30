/**
 * The run of the file access check, as the check page drives it. Each step asks the background
 * or fetches in the page, and the results go into one `CheckResults` that the report prints.
 */
import { probeFileFetch } from '../../shared/canvas/fileFetch';
import { isCanvasId } from '../../shared/canvas/ids';
import type {
  FileCheckFileReply,
  FileCheckFrameReply,
  FileCheckMessage,
  FileCheckScanReply,
} from './protocol';
import { parseFileInput } from './scan';
import type { CheckResults } from './types';

export interface RunDeps {
  /** The saved Canvas origin. */
  origin: string;
  send(message: FileCheckMessage): Promise<unknown>;
  fetchImpl?: typeof fetch;
  /** Called after each step with the results so far. */
  onProgress?(results: CheckResults, step: string): void;
}

export function emptyResults(): CheckResults {
  return {
    scan: null,
    scanError: null,
    fileSource: null,
    api: null,
    background: null,
    extensionPage: null,
    frame: null,
    head: null,
    notes: [],
  };
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

/**
 * Runs the check. `pasted` is the text the student pasted, an id or a file address, or an empty
 * string. A step that fails adds a note and the run goes on with the next step.
 */
export async function runFileCheck(pasted: string, deps: RunDeps): Promise<CheckResults> {
  const results = emptyResults();
  const progress = (step: string): void => deps.onProgress?.({ ...results }, step);

  let tabId: number | null = null;
  try {
    const reply = asObject(
      await deps.send({ type: 'weekrow:file-check-scan' }),
    ) as FileCheckScanReply | null;
    if (reply === null) throw new Error('no reply');
    tabId = reply.tabId;
    results.scan = reply.scan;
    results.scanError = reply.error;
  } catch {
    results.scanError = 'scan_failed';
  }
  progress('scan');

  const pastedId = pasted.trim() === '' ? null : parseFileInput(pasted);
  if (pasted.trim() !== '' && pastedId === null) {
    results.notes.push('The pasted text holds no file id. The check used the file of the page.');
  }
  const fileId = pastedId ?? results.scan?.fileId ?? null;
  results.fileSource = pastedId !== null ? 'pasted' : fileId !== null ? 'page' : null;

  if (fileId === null || !isCanvasId(fileId)) {
    results.notes.push(
      'No file was found on the page and no file id was pasted, so the file steps did not run.',
    );
  } else {
    try {
      const reply = asObject(
        await deps.send({ type: 'weekrow:file-check-file', fileId }),
      ) as FileCheckFileReply | null;
      if (reply === null) throw new Error('no reply');
      results.api = reply.api;
      results.background = reply.background;
      progress('api');
      if (typeof reply.url === 'string') {
        results.extensionPage = await probeFileFetch(
          deps.origin,
          reply.url,
          'extension page',
          deps.fetchImpl,
        );
      } else {
        results.notes.push('The file answer had no url, so the bytes were not fetched.');
      }
    } catch {
      results.notes.push('The file steps failed before an answer.');
    }
    progress('file');
  }

  if (tabId === null) {
    results.notes.push('No Canvas tab was found, so the frame check did not run.');
  } else {
    try {
      const reply = asObject(
        await deps.send({ type: 'weekrow:file-check-frame', tabId }),
      ) as FileCheckFrameReply | null;
      if (reply === null) throw new Error('no reply');
      results.frame = reply.frame;
      results.head = reply.head;
    } catch {
      results.notes.push('The frame check failed before an answer.');
    }
  }
  progress('frame');
  return results;
}
