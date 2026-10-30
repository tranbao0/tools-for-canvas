import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  pickTab,
  routeFileCheckMessage,
  wireFileCheck,
  type CanvasTab,
  type FileCheckHost,
} from './background';

const ORIGIN = 'https://school.instructure.com';
const PAGE_URL = `${ORIGIN}/courses/5/files/Alice-resume.pdf?verifier=SECRETVERIFIER`;
const EXTENSION = { url: 'chrome-extension://abc/file-check.html' };
const PAGE_SENDER = { url: `${ORIGIN}/`, tab: { id: 3 }, frameId: 0 };

function jsonReply(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
    ...init,
  });
}

function host(overrides: Partial<FileCheckHost> = {}): FileCheckHost {
  const tabs: CanvasTab[] = [{ id: 7, url: PAGE_URL, lastAccessed: 100 }];
  return {
    isExtensionPage: (sender) => sender.url?.startsWith('chrome-extension://abc/') === true,
    savedOrigin: async () => ORIGIN,
    tabsOnOrigin: async () => tabs,
    tabUrl: async () => PAGE_URL,
    runScan: async () => ({
      pagePath: '/courses/5/files',
      kinds: [{ kind: 'files_href', count: 2, sample: '/courses/5/files/Alice.pdf', hooks: [] }],
      fileId: '42',
      fileIdKind: 'files_href',
      metaCsp: null,
    }),
    runFrame: async () => ({
      src: 'chrome-extension://x/file-probe.html?n=1',
      handshake: true,
      loadEvent: true,
      ms: 20,
      error: null,
    }),
    openCheckPage: vi.fn(async () => undefined),
    newNonce: () => '00000000-0000-4000-8000-000000000000',
    ...overrides,
  };
}

async function ask(message: unknown, sender: object, h: FileCheckHost): Promise<unknown> {
  const reply = routeFileCheckMessage(message, sender, h);
  if (reply === null) throw new Error('not routed');
  return reply;
}

describe('pickTab', () => {
  it('takes the tab used last', () => {
    expect(
      pickTab([
        { id: 1, url: 'a', lastAccessed: 5 },
        { id: 2, url: 'b', lastAccessed: 9 },
        { id: 3, url: 'c', lastAccessed: 7 },
      ])?.id,
    ).toBe(2);
    expect(pickTab([])).toBeNull();
  });
});

describe('routeFileCheckMessage', () => {
  it('leaves other messages alone', () => {
    expect(routeFileCheckMessage({ type: 'weekrow:get-state' }, EXTENSION, host())).toBeNull();
    expect(routeFileCheckMessage('text', EXTENSION, host())).toBeNull();
    expect(
      routeFileCheckMessage({ type: 'weekrow:file-check-file', fileId: 'abc' }, EXTENSION, host()),
    ).toBeNull();
    expect(
      routeFileCheckMessage({ type: 'weekrow:file-check-frame', tabId: 'x' }, EXTENSION, host()),
    ).toBeNull();
  });

  it('scans the Canvas tab used last and redacts the answer', async () => {
    const runScan = vi.fn(host().runScan);
    const reply = (await ask(
      { type: 'weekrow:file-check-scan' },
      EXTENSION,
      host({ runScan }),
    )) as {
      tabId: number;
      scan: { fileId: string; kinds: { sample: string | null }[] };
    };
    expect(runScan).toHaveBeenCalledWith(7);
    expect(reply.tabId).toBe(7);
    expect(reply.scan.fileId).toBe('42');
    expect(JSON.stringify(reply)).not.toMatch(/Alice|SECRET/);
  });

  it('says so when no Canvas tab is open', async () => {
    const reply = await ask(
      { type: 'weekrow:file-check-scan' },
      EXTENSION,
      host({ tabsOnOrigin: async () => [] }),
    );
    expect(reply).toEqual({ tabId: null, scan: null, error: 'no_canvas_tab' });
  });

  it('survives a failed scan', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const reply = await ask(
      { type: 'weekrow:file-check-scan' },
      EXTENSION,
      host({ runScan: async () => Promise.reject(new Error('Cannot access')) }),
    );
    expect(reply).toEqual({ tabId: 7, scan: null, error: 'scan_failed' });
  });

  it('answers the file API and fetches the bytes from the background', async () => {
    const requests: { url: string; method?: string; redirect?: string }[] = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(url), method: init?.method, redirect: init?.redirect });
      if (String(url).includes('/api/v1/files/42')) {
        return jsonReply({
          id: '42',
          size: 1234,
          'content-type': 'application/pdf',
          display_name: 'Alice Smith resume.pdf',
          url: `${ORIGIN}/files/42/download?download_frd=1&verifier=SECRETVERIFIER`,
          preview_url: '/api/v1/canvadoc_session?token=SECRETTOKEN',
        });
      }
      return new Response('%PDF-1.4 x', {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      });
    });
    const reply = (await ask(
      { type: 'weekrow:file-check-file', fileId: '42' },
      EXTENSION,
      host({ fetchImpl: fetchImpl as unknown as typeof fetch }),
    )) as { api: unknown; background: { pdfSignature: boolean }; url: string };
    expect(reply.api).toEqual({
      status: 200,
      error: null,
      contentType: 'application/json',
      size: 1234,
      fileContentType: 'application/pdf',
      hasUrl: true,
      hasPreviewUrl: true,
      url: { host: 'school.instructure.com', path: '/files/:id/download', sameOrigin: true },
      previewUrl: { host: 'school.instructure.com', path: '/api/v1', sameOrigin: true },
    });
    expect(reply.background.pdfSignature).toBe(true);
    expect(reply.url).toContain('verifier=SECRETVERIFIER');
    expect(JSON.stringify({ api: reply.api, background: reply.background })).not.toMatch(
      /SECRET|Alice/,
    );
    expect(requests.every((request) => request.method === 'GET')).toBe(true);
  });

  it('records a file address on another origin and does not fetch it', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonReply({ id: '42', url: 'https://files.example.com/Alice/resume.pdf?token=SECRETTOKEN' }),
    );
    const reply = (await ask(
      { type: 'weekrow:file-check-file', fileId: '42' },
      EXTENSION,
      host({ fetchImpl: fetchImpl as unknown as typeof fetch }),
    )) as { api: { url: unknown }; background: { threw: string; hops: { host: string }[] } };
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(reply.api.url).toEqual({ host: 'files.example.com', path: '/', sameOrigin: false });
    expect(reply.background.threw).toBe('origin_blocked');
    expect(reply.background.hops[0]?.host).toBe('files.example.com');
  });

  it('records a 404 of the file API', async () => {
    const fetchImpl = vi.fn(async () => jsonReply({ errors: [] }, { status: 404 }));
    const reply = (await ask(
      { type: 'weekrow:file-check-file', fileId: '42' },
      EXTENSION,
      host({ fetchImpl: fetchImpl as unknown as typeof fetch }),
    )) as { api: { status: number; hasUrl: boolean }; background: unknown; url: unknown };
    expect(reply.api).toMatchObject({ status: 404, hasUrl: false });
    expect(reply.background).toBeNull();
    expect(reply.url).toBeNull();
  });

  it('records a redirect of the file API as a failure with its status', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302 }));
    const reply = (await ask(
      { type: 'weekrow:file-check-file', fileId: '42' },
      EXTENSION,
      host({ fetchImpl: fetchImpl as unknown as typeof fetch }),
    )) as { api: { status: number; error: string } };
    expect(reply.api).toMatchObject({ status: 302, error: 'redirect' });
  });

  it('reads the policy header with a HEAD of the page, and runs the frame probe', async () => {
    const requests: { url: string; method?: string; accept?: string }[] = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(url),
        method: init?.method,
        accept: (init?.headers as Record<string, string>)['Accept'],
      });
      return new Response(null, {
        status: 200,
        headers: {
          'content-security-policy':
            "frame-src 'self' 'nonce-abc123' https://x.example.com/Alice?token=1",
        },
      });
    });
    const runFrame = vi.fn(host().runFrame);
    const reply = (await ask(
      { type: 'weekrow:file-check-frame', tabId: 7 },
      EXTENSION,
      host({ fetchImpl: fetchImpl as unknown as typeof fetch, runFrame }),
    )) as { frame: unknown; head: unknown };
    expect(runFrame).toHaveBeenCalledWith(7, '00000000-0000-4000-8000-000000000000');
    expect(requests).toEqual([{ url: PAGE_URL, method: 'HEAD', accept: 'text/html' }]);
    expect(reply.head).toEqual({
      path: '/courses/:id/files',
      status: 200,
      error: null,
      csp: "frame-src 'self' 'nonce-REDACTED' https://x.example.com",
      cspReportOnly: null,
    });
    expect(reply.frame).toMatchObject({ scheme: 'chrome-extension', handshake: true });
    expect(JSON.stringify(reply)).not.toMatch(/SECRET|Alice|abc123/);
  });

  it('refuses the frame check for a tab that is not on the saved Canvas', async () => {
    const run = ask(
      { type: 'weekrow:file-check-frame', tabId: 7 },
      EXTENSION,
      host({ tabUrl: async () => 'https://evil.example.com/' }),
    );
    await expect(run).rejects.toThrow(/saved Canvas/);
  });

  it('refuses when the tab leaves the saved Canvas during the probe', async () => {
    const tabUrl = vi
      .fn<(id: number) => Promise<string | undefined>>()
      .mockResolvedValueOnce(PAGE_URL)
      .mockResolvedValueOnce('https://evil.example.com/');
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const run = ask(
      { type: 'weekrow:file-check-frame', tabId: 7 },
      EXTENSION,
      host({ tabUrl, fetchImpl: fetchImpl as unknown as typeof fetch }),
    );
    await expect(run).rejects.toThrow(/left the saved Canvas/);
  });

  it('reports a failed injection as a result', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const reply = (await ask(
      { type: 'weekrow:file-check-frame', tabId: 7 },
      EXTENSION,
      host({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        runFrame: async () => Promise.reject(new Error('no access')),
      }),
    )) as { frame: { handshake: boolean; error: string } };
    expect(reply.frame).toMatchObject({ handshake: false, error: 'inject_failed' });
  });

  it('lets only extension pages run a step', async () => {
    for (const message of [
      { type: 'weekrow:file-check-scan' },
      { type: 'weekrow:file-check-file', fileId: '42' },
      { type: 'weekrow:file-check-frame', tabId: 7 },
    ]) {
      await expect(ask(message, PAGE_SENDER, host())).rejects.toThrow(/extension pages/);
    }
  });

  it('opens the check page for an extension page or the saved Canvas only', async () => {
    const openCheckPage = vi.fn(async () => undefined);
    const h = host({ openCheckPage });
    await ask({ type: 'weekrow:file-check-open' }, EXTENSION, h);
    await ask({ type: 'weekrow:file-check-open' }, PAGE_SENDER, h);
    expect(openCheckPage).toHaveBeenCalledTimes(2);
    for (const sender of [
      { url: 'https://evil.example.com/', tab: { id: 1 }, frameId: 0 },
      { url: `${ORIGIN}/`, tab: { id: 1 }, frameId: 2 },
      { url: `${ORIGIN}/` },
    ]) {
      await expect(ask({ type: 'weekrow:file-check-open' }, sender, h)).rejects.toThrow(
        /saved Canvas/,
      );
    }
    expect(openCheckPage).toHaveBeenCalledTimes(2);
  });

  it('refuses every message when no Canvas is saved', async () => {
    const h = host({ savedOrigin: async () => null });
    await expect(ask({ type: 'weekrow:file-check-scan' }, EXTENSION, h)).rejects.toThrow(
      /No Canvas/,
    );
  });
});

describe('wireFileCheck', () => {
  beforeEach(() => fakeBrowser.reset());

  it('answers runtime messages and leaves the others alone', async () => {
    const stop = wireFileCheck(host({ isExtensionPage: () => true }));
    await expect(
      fakeBrowser.runtime.sendMessage({ type: 'weekrow:file-check-scan' }),
    ).resolves.toMatchObject({
      tabId: 7,
    });
    const other = vi.fn(
      (_message: unknown, _sender: unknown, sendResponse: (reply: unknown) => void) => {
        sendResponse({ open: true });
        return true;
      },
    );
    fakeBrowser.runtime.onMessage.addListener(other);
    await expect(fakeBrowser.runtime.sendMessage({ type: 'weekrow:other' })).resolves.toEqual({
      open: true,
    });
    stop();
  });

  it('answers undefined when the sender may not run the step', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const stop = wireFileCheck(host({ isExtensionPage: () => false }));
    await expect(
      fakeBrowser.runtime.sendMessage({ type: 'weekrow:file-check-scan' }),
    ).resolves.toBeUndefined();
    stop();
  });
});
