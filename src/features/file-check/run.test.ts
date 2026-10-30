import { describe, expect, it, vi } from 'vitest';
import type { FileCheckMessage } from './protocol';
import { runFileCheck } from './run';
import type { ScanSummary } from './types';

const ORIGIN = 'https://school.instructure.com';

const SCAN: ScanSummary = {
  pagePath: '/courses/:id/files',
  kinds: [],
  fileId: '42',
  fileIdKind: 'files_href',
  metaCsp: null,
};

const API = {
  status: 200,
  error: null,
  contentType: 'application/json',
  size: 5,
  fileContentType: 'application/pdf',
  hasUrl: true,
  hasPreviewUrl: false,
  url: null,
  previewUrl: null,
};

function sender(overrides: Record<string, unknown> = {}) {
  const sent: FileCheckMessage[] = [];
  const send = vi.fn(async (message: FileCheckMessage): Promise<unknown> => {
    sent.push(message);
    const reply = overrides[message.type];
    if (reply instanceof Error) throw reply;
    if (reply !== undefined) return reply;
    switch (message.type) {
      case 'weekrow:file-check-scan':
        return { tabId: 7, scan: SCAN, error: null };
      case 'weekrow:file-check-file':
        return {
          api: API,
          background: null,
          url: `${ORIGIN}/files/42/download?verifier=SECRETVERIFIER`,
        };
      case 'weekrow:file-check-frame':
        return {
          frame: {
            scheme: 'chrome-extension',
            handshake: true,
            loadEvent: true,
            ms: 5,
            error: null,
          },
          head: { path: '/', status: 200, error: null, csp: null, cspReportOnly: null },
        };
      default:
        return { ok: true };
    }
  });
  return { send, sent };
}

describe('runFileCheck', () => {
  it('runs every step with the file of the page and fetches in the page', async () => {
    const { send, sent } = sender();
    const fetchImpl = vi.fn(async () => new Response('%PDF-1', { status: 200 }));
    const steps: string[] = [];
    const results = await runFileCheck('', {
      origin: ORIGIN,
      send,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onProgress: (_results, step) => steps.push(step),
    });
    expect(sent.map((message) => message.type)).toEqual([
      'weekrow:file-check-scan',
      'weekrow:file-check-file',
      'weekrow:file-check-frame',
    ]);
    expect(sent[1]).toEqual({ type: 'weekrow:file-check-file', fileId: '42' });
    expect(sent[2]).toEqual({ type: 'weekrow:file-check-frame', tabId: 7 });
    expect(results.fileSource).toBe('page');
    expect(results.extensionPage).toMatchObject({ context: 'extension page', pdfSignature: true });
    expect(results.frame?.handshake).toBe(true);
    expect(steps).toEqual(['scan', 'api', 'file', 'frame']);
    expect(results.notes).toEqual([]);
  });

  it('prefers a pasted file id or file link', async () => {
    const { send, sent } = sender();
    const fetchImpl = vi.fn(async () => new Response('x'));
    const results = await runFileCheck('https://school.instructure.com/files/99/download?x=1', {
      origin: ORIGIN,
      send,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(sent[1]).toEqual({ type: 'weekrow:file-check-file', fileId: '99' });
    expect(results.fileSource).toBe('pasted');
  });

  it('notes pasted text without an id and falls back to the page file', async () => {
    const { send, sent } = sender();
    const fetchImpl = vi.fn(async () => new Response('x'));
    const results = await runFileCheck('hello', {
      origin: ORIGIN,
      send,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(sent[1]).toEqual({ type: 'weekrow:file-check-file', fileId: '42' });
    expect(results.notes[0]).toMatch(/no file id/);
  });

  it('skips the file steps when there is no file, and still checks the frame', async () => {
    const { send, sent } = sender({
      'weekrow:file-check-scan': { tabId: 7, scan: { ...SCAN, fileId: null }, error: null },
    });
    const results = await runFileCheck('', { origin: ORIGIN, send });
    expect(sent.map((message) => message.type)).toEqual([
      'weekrow:file-check-scan',
      'weekrow:file-check-frame',
    ]);
    expect(results.api).toBeNull();
    expect(results.notes.join(' ')).toMatch(/No file was found/);
    expect(results.frame).not.toBeNull();
  });

  it('skips the frame check when no Canvas tab exists', async () => {
    const { send, sent } = sender({
      'weekrow:file-check-scan': { tabId: null, scan: null, error: 'no_canvas_tab' },
    });
    const results = await runFileCheck('42', {
      origin: ORIGIN,
      send,
      fetchImpl: (async () => new Response('x')) as unknown as typeof fetch,
    });
    expect(sent.map((message) => message.type)).not.toContain('weekrow:file-check-frame');
    expect(results.scanError).toBe('no_canvas_tab');
    expect(results.notes.join(' ')).toMatch(/No Canvas tab/);
  });

  it('goes on after a step fails', async () => {
    const { send } = sender({
      'weekrow:file-check-scan': new Error('boom'),
      'weekrow:file-check-file': new Error('boom'),
      'weekrow:file-check-frame': new Error('boom'),
    });
    const results = await runFileCheck('42', { origin: ORIGIN, send });
    expect(results.scanError).toBe('scan_failed');
    expect(results.notes.join(' ')).toMatch(/file steps failed/);
  });

  it('does not fetch when the file answer has no url', async () => {
    const { send } = sender({
      'weekrow:file-check-file': { api: { ...API, hasUrl: false }, background: null, url: null },
    });
    const fetchImpl = vi.fn();
    const results = await runFileCheck('', {
      origin: ORIGIN,
      send,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(results.extensionPage).toBeNull();
    expect(results.notes.join(' ')).toMatch(/no url/);
  });
});
