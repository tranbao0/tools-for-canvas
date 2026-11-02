// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileBytesError } from '../../../shared/canvas/fileBytes';
import type { Tabs } from '../model';
import type { PdfjsLib } from '../pdf/types';
import type { PaneFile } from './FileCard';
import { createOpenSource } from './openSource';
import { ViewerApp, type PaneHost } from './ViewerApp';

afterEach(cleanup);

const ORIGIN = 'https://school.instructure.com';
const MB = 1024 * 1024;
const PDF: PaneFile = {
  name: 'Notes.pdf',
  contentType: 'application/pdf',
  size: 271512,
  url: '/files/1/download',
  courseId: '7',
};
const FILES: Record<string, PaneFile> = {
  '1': PDF,
  '2': {
    name: 'Photo.png',
    contentType: 'image/png',
    size: 2048,
    url: '/files/2/download',
    courseId: null,
  },
  '3': {
    name: 'Deck.pptx',
    contentType: '',
    size: 10,
    url: '/files/3/download',
    courseId: null,
  },
};

const never = () => new Promise<Uint8Array>(() => undefined);

function setup(overrides: Partial<PaneHost> = {}) {
  let saved: Tabs = { ids: [], active: null };
  const host: PaneHost = {
    origin: ORIGIN,
    loadFile: vi.fn(async (id: string) => FILES[id]),
    hasAccess: vi.fn(async () => true),
    requestAccess: vi.fn(async () => true),
    getTabs: vi.fn(async () => saved),
    setTabs: vi.fn(async (tabs: Tabs) => {
      saved = tabs;
    }),
    closePane: vi.fn(),
    readFile: vi.fn(never),
    loadPdfjs: vi.fn(() => new Promise<PdfjsLib>(() => undefined)),
    ...overrides,
  };
  const opens = createOpenSource();
  render(<ViewerApp host={host} opens={opens} />);
  const open = async (fileId: string) => {
    saved = {
      ids: saved.ids.includes(fileId) ? saved.ids : [...saved.ids, fileId],
      active: fileId,
    };
    await act(async () => {
      opens.emit({ fileId });
    });
  };
  return { host, open };
}

describe('pdf tabs', () => {
  it('reads the bytes of the active PDF from the cleaned download address, and loads PDF.js', async () => {
    const { open, host } = setup();
    await open('1');
    await waitFor(() => expect(host.readFile).toHaveBeenCalledOnce());
    expect(vi.mocked(host.readFile).mock.calls[0]![0]).toBe(`${ORIGIN}/files/1/download`);
    expect(host.loadPdfjs).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-part="pdf-loading"]')).toBeTruthy();
  });

  it('keeps a download address on another host out of the read', async () => {
    const { open, host } = setup({
      loadFile: vi.fn(async () => ({ ...PDF, url: 'https://evil.example/files/1/download' })),
    });
    await open('1');
    await waitFor(() => expect(host.readFile).toHaveBeenCalledOnce());
    expect(vi.mocked(host.readFile).mock.calls[0]![0]).toBe(`${ORIGIN}/files/1/download`);
  });

  it('shows a determinate bar with the part read, clamped to 100 percent', async () => {
    let report: (loaded: number, total: number | null) => void = () => undefined;
    const { open, host } = setup({
      readFile: vi.fn((_url, onProgress) => {
        report = onProgress;
        return never();
      }),
    });
    await open('1');
    await waitFor(() => expect(host.readFile).toHaveBeenCalledOnce());
    const bar = async () => await screen.findByRole('progressbar');
    expect((await bar()).getAttribute('data-indeterminate')).toBe('true');
    expect((await bar()).getAttribute('aria-valuenow')).toBeNull();
    await act(async () => report(50, 200));
    expect((await bar()).getAttribute('data-indeterminate')).toBe('false');
    expect((await bar()).getAttribute('aria-valuenow')).toBe('25');
    await act(async () => report(500, 200));
    expect((await bar()).getAttribute('aria-valuenow')).toBe('100');
    await act(async () => report(10, null));
    expect((await bar()).getAttribute('data-indeterminate')).toBe('true');
    await act(async () => report(10, 0));
    expect((await bar()).getAttribute('data-indeterminate')).toBe('true');
  });

  it('shows a slim line and icon buttons for a PDF, not the card', async () => {
    const { open } = setup();
    await open('1');
    await waitFor(() => expect(document.querySelector('[data-part="pdf-name"]')).toBeTruthy());
    expect(document.querySelector('[data-part="card"]')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Notes.pdf' })).toBeNull();
    expect(document.querySelector('[data-part="pdf-name"]')?.textContent).toBe('Notes.pdf');
    expect(document.querySelector('[data-part="pdf-meta"]')?.textContent).toBe('PDF · 265 KB');
    const download = screen.getByRole('link', { name: 'Download' }) as HTMLAnchorElement;
    const canvas = screen.getByRole('link', { name: 'Open in Canvas' }) as HTMLAnchorElement;
    expect(download.href).toBe(`${ORIGIN}/files/1/download`);
    expect(canvas.href).toBe(`${ORIGIN}/courses/7/files/1`);
    for (const link of [download, canvas]) {
      expect(link.title).toBe(link.getAttribute('aria-label'));
      expect(link.target).toBe('_blank');
      expect(link.rel).toContain('noopener');
      expect(link.textContent).toBe('');
    }
  });

  it('keeps the card while the record loads and when it fails', async () => {
    let release: (file: PaneFile | undefined) => void = () => undefined;
    const { open, host } = setup({
      loadFile: vi.fn(() => new Promise<PaneFile | undefined>((resolve) => (release = resolve))),
    });
    await open('1');
    await waitFor(() => expect(host.loadFile).toHaveBeenCalledOnce());
    await waitFor(() => expect(document.querySelector('[data-part="card-loading"]')).toBeTruthy());
    await act(async () => release(undefined));
    await screen.findByText("Couldn't load this file");
    expect(document.querySelector('[data-part="pdf-info"]')).toBeNull();
  });

  it('reads no file over 100 MB, and the card stays', async () => {
    const { open, host } = setup({
      loadFile: vi.fn(async () => ({ ...PDF, size: 150 * MB })),
    });
    await open('1');
    await screen.findByRole('heading', { name: 'Notes.pdf' });
    expect(screen.getByRole('link', { name: 'Download' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open in Canvas' })).toBeTruthy();
    expect(host.readFile).not.toHaveBeenCalled();
    expect(host.loadPdfjs).not.toHaveBeenCalled();
    expect(document.querySelector('[data-part="pdf-tab"]')).toBeNull();
  });

  it('reads a file that is exactly 100 MB, and a file of unknown size', async () => {
    const exact = setup({ loadFile: vi.fn(async () => ({ ...PDF, size: 100 * MB })) });
    await exact.open('1');
    await waitFor(() => expect(exact.host.readFile).toHaveBeenCalledOnce());
    cleanup();
    const unknown = setup({ loadFile: vi.fn(async () => ({ ...PDF, size: Number.NaN })) });
    await unknown.open('1');
    await waitFor(() => expect(unknown.host.readFile).toHaveBeenCalledOnce());
  });

  it('reads only a PDF, by its content type', async () => {
    const { open, host } = setup({
      loadFile: vi.fn(async (id: string) =>
        id === '1' ? { ...PDF, contentType: 'application/pdf; charset=binary' } : FILES[id],
      ),
    });
    await open('2');
    await screen.findByRole('heading', { name: 'Photo.png' });
    await open('3');
    await screen.findByRole('heading', { name: 'Deck.pptx' });
    expect(host.readFile).not.toHaveBeenCalled();
    await open('1');
    await waitFor(() => expect(host.readFile).toHaveBeenCalledOnce());
  });

  it('keeps the tab of a PDF in the document while another tab is active', async () => {
    const { open, host } = setup();
    await open('1');
    await waitFor(() => expect(host.readFile).toHaveBeenCalledOnce());
    await open('2');
    await screen.findByRole('heading', { name: 'Photo.png' });
    expect(host.readFile).toHaveBeenCalledOnce();
    const tab = document.querySelector<HTMLElement>('[data-part="pdf-tab"]');
    expect(tab?.hidden).toBe(true);
  });

  it('does not read a PDF in a tab that has never been active', async () => {
    const { open, host } = setup();
    await open('2');
    await screen.findByRole('heading', { name: 'Photo.png' });
    await open('1');
    await waitFor(() => expect(host.readFile).toHaveBeenCalledOnce());
    await open('3');
    await screen.findByRole('heading', { name: 'Deck.pptx' });
    // A second PDF behind the active tab waits until its tab opens.
    expect(host.readFile).toHaveBeenCalledOnce();
  });

  it('shows the error with Retry when the read fails, and the slim line stays', async () => {
    let fail = true;
    const { open, host } = setup({
      readFile: vi.fn(async () => {
        if (fail) throw new Error('offline');
        return never();
      }),
    });
    await open('1');
    await screen.findByText("Couldn't load this PDF");
    expect(document.querySelector('[data-part="pdf-name"]')?.textContent).toBe('Notes.pdf');
    expect(screen.queryByRole('button', { name: 'Allow access' })).toBeNull();
    // The pane checks the permission after the failure.
    expect(vi.mocked(host.hasAccess).mock.calls.length).toBeGreaterThanOrEqual(2);
    fail = false;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    });
    await waitFor(() => expect(host.readFile).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Couldn't load this PDF")).toBeNull();
  });

  it('shows the card only, without Retry, when the bytes pass the limit', async () => {
    const { open } = setup({
      readFile: vi.fn(async () => {
        throw new FileBytesError('too_large', 'The file is too large');
      }),
    });
    await open('1');
    await screen.findByText("This PDF can't be shown. Use Download or Open in Canvas.");
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Download' })).toBeTruthy();
  });

  it('shows Allow access after a failed read while the permission is withheld, and reads again', async () => {
    let granted = false;
    let fail = true;
    const { open, host } = setup({
      hasAccess: vi.fn(async () => granted),
      requestAccess: vi.fn(async () => {
        granted = true;
        return true;
      }),
      readFile: vi.fn(async () => {
        if (fail) throw new TypeError('Failed to fetch');
        return never();
      }),
    });
    await open('1');
    const allow = await screen.findByRole('button', { name: 'Allow access' });
    await screen.findByText("Couldn't load this PDF");
    fail = false;
    await act(async () => {
      fireEvent.click(allow);
    });
    await waitFor(() => expect(host.readFile).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Allow access' })).toBeNull());
  });

  it('shows Open in Canvas, with Retry, when the sign-in is not confirmed', async () => {
    const { open, host } = setup({
      readFile: vi.fn(async () => {
        throw new FileBytesError('unconfirmed', 'The sign-in is not confirmed');
      }),
    });
    await open('1');
    await screen.findByText("Canvas can't confirm your sign-in for this file. Use Open in Canvas.");
    const text = document.querySelector<HTMLAnchorElement>('[data-part="open-in-canvas-text"]');
    expect(text?.href).toBe(`${ORIGIN}/courses/7/files/1`);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    // The permission is fine, so the failure does not ask for it again.
    expect(host.hasAccess).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: 'Allow access' })).toBeNull();
  });

  it('shows a message and no Retry when PDF.js cannot load', async () => {
    const { open } = setup({
      readFile: vi.fn(async () => new Uint8Array([1])),
      loadPdfjs: vi.fn(async () => {
        throw new Error('missing');
      }),
    });
    await open('1');
    await screen.findByText("This PDF can't be shown. Use Download or Open in Canvas.");
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('tells the student about a PDF that needs a password', async () => {
    const lib = {
      PDFWorker: class {
        destroy() {}
      },
      getDocument: () => ({
        destroy: () => Promise.resolve(),
        promise: Promise.reject(
          Object.assign(new Error('password'), { name: 'PasswordException' }),
        ),
      }),
    } as unknown as PdfjsLib;
    const { open } = setup({
      readFile: vi.fn(async () => new Uint8Array([1])),
      loadPdfjs: vi.fn(async () => lib),
    });
    await open('1');
    await screen.findByText('This PDF needs a password. Use Download or Open in Canvas.');
  });

  it('stops the read when the tab closes', async () => {
    let signal: AbortSignal | undefined;
    const { open } = setup({
      readFile: vi.fn((_url, _progress, aborter) => {
        signal = aborter;
        return never();
      }),
    });
    await open('1');
    await waitFor(() => expect(signal).toBeDefined());
    expect(signal!.aborted).toBe(false);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Close Notes.pdf' }));
    });
    expect(signal!.aborted).toBe(true);
  });
});
