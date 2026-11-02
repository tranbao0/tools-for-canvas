// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Tabs } from '../model';
import type { PdfjsLib } from '../pdf/types';
import type { PaneFile } from './FileCard';
import { createOpenSource } from './openSource';
import { ViewerApp, type PaneHost } from './ViewerApp';

afterEach(cleanup);

const ORIGIN = 'https://school.instructure.com';
const FILES: Record<string, PaneFile> = {
  '1': {
    name: 'Notes.docx',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    size: 271512,
    url: '/files/1/download',
    courseId: '7',
  },
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

function setup(overrides: Partial<PaneHost> = {}, stored: Tabs = { ids: [], active: null }) {
  let saved = stored;
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
    readFile: vi.fn(() => new Promise<Uint8Array>(() => undefined)),
    loadPdfjs: vi.fn(() => new Promise<PdfjsLib>(() => undefined)),
    ...overrides,
  };
  const opens = createOpenSource();
  render(<ViewerApp host={host} opens={opens} />);
  const open = async (fileId: string, courseId?: string) => {
    saved = {
      ids: saved.ids.includes(fileId) ? saved.ids : [...saved.ids, fileId],
      active: fileId,
    };
    await act(async () => {
      opens.emit({ fileId, ...(courseId ? { courseId } : {}) });
    });
  };
  return { host, open, opens, saved: () => saved };
}

const tabs = () => screen.queryAllByRole('tab');

describe('pane tabs', () => {
  it('shows a placeholder before a file opens', () => {
    setup();
    expect(screen.getByRole('status').textContent).toBe('Loading file');
    expect(tabs()).toHaveLength(0);
  });

  it('opens one tab for each file and activates an open file again', async () => {
    const { open, host } = setup();
    await open('1');
    await open('2');
    await waitFor(() => expect(tabs()).toHaveLength(2));
    expect(tabs()[1]!.getAttribute('aria-selected')).toBe('true');
    await open('1');
    expect(tabs()).toHaveLength(2);
    expect(tabs()[0]!.getAttribute('aria-selected')).toBe('true');
    expect(host.loadFile).toHaveBeenCalledTimes(2);
  });

  it('moves between tabs with the arrow, Home and End keys, and activates at once', async () => {
    const { open } = setup();
    for (const id of ['1', '2', '3']) await open(id);
    await waitFor(() => expect(tabs()).toHaveLength(3));
    const press = async (key: string) => {
      const focused = document.activeElement ?? tabs()[0]!;
      await act(async () => {
        fireEvent.keyDown(focused, { key });
      });
    };
    tabs()[2]!.focus();
    await press('ArrowRight');
    expect(tabs()[0]!.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabs()[0]);
    await press('End');
    expect(tabs()[2]!.getAttribute('aria-selected')).toBe('true');
    await press('ArrowLeft');
    expect(tabs()[1]!.getAttribute('aria-selected')).toBe('true');
    await press('Home');
    expect(tabs()[0]!.getAttribute('aria-selected')).toBe('true');
    expect(tabs().map((tab) => tab.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
  });

  it('closes a tab, activates the next one and saves the tabs', async () => {
    const { open, host, saved } = setup();
    for (const id of ['1', '2', '3']) await open(id);
    await waitFor(() => expect(tabs()).toHaveLength(3));
    await act(async () => {
      fireEvent.click(tabs()[0]!);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Close Notes.docx' }));
    });
    expect(tabs()).toHaveLength(2);
    expect(tabs()[0]!.getAttribute('aria-selected')).toBe('true');
    await waitFor(() => expect(saved()).toEqual({ ids: ['2', '3'], active: '2' }));
    expect(host.closePane).not.toHaveBeenCalled();
  });

  it('closes the pane when the last tab closes', async () => {
    const { open, host } = setup();
    await open('1');
    await screen.findByRole('heading', { name: 'Notes.docx' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Close Notes.docx' }));
    });
    expect(host.closePane).toHaveBeenCalledOnce();
  });

  it('loads a file again when it opens again after an error', async () => {
    let fail = true;
    const { open, host } = setup({
      loadFile: vi.fn(async (id: string) => (fail ? undefined : FILES[id])),
    });
    await open('1');
    await open('2');
    await waitFor(() => expect(screen.getAllByText("Couldn't load this file")).toHaveLength(1));
    fail = false;
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: /^Close Unavailable file/ })[0]!);
    });
    await open('1');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Notes.docx' })).toBeTruthy());
    expect(host.loadFile).toHaveBeenCalledTimes(3);
  });

  it('keeps a closed tab closed when the page opens another file', async () => {
    const { open, opens, saved } = setup();
    await open('1');
    await open('2');
    await screen.findByRole('heading', { name: 'Photo.png' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Close Photo.png' }));
    });
    // The page asks for a third file while its own copy of the tabs is old.
    await act(async () => {
      opens.emit({ fileId: '3' });
    });
    expect(tabs().map((tab) => tab.getAttribute('data-file-id'))).toEqual(['1', '3']);
    await waitFor(() => expect(saved().ids).toEqual(['1', '3']));
  });

  it('keeps both files when two requests come before the stored tabs are read', async () => {
    let release: (tabs: Tabs) => void = () => undefined;
    const { opens, saved } = setup({
      getTabs: vi.fn(() => new Promise<Tabs>((resolve) => (release = resolve))),
    });
    await act(async () => {
      opens.emit({ fileId: '2' });
      opens.emit({ fileId: '1' });
    });
    await act(async () => {
      release({ ids: ['1'], active: '1' });
    });
    await waitFor(() => expect(tabs()).toHaveLength(2));
    expect(tabs().map((tab) => tab.getAttribute('data-file-id'))).toEqual(['1', '2']);
    expect(tabs().map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false']);
    await waitFor(() => expect(saved().ids).toEqual(['1', '2']));
  });

  it('restores every stored tab when the pane page loads again', async () => {
    const { open } = setup({}, { ids: ['1', '2'], active: '1' });
    await open('1');
    await waitFor(() => expect(tabs()).toHaveLength(2));
    expect(tabs()[0]!.getAttribute('aria-selected')).toBe('true');
  });
});

describe('tabs that fail to load', () => {
  it('does not treat a refused read as no tabs, and reads again at the next request', async () => {
    let refuse = true;
    const stored: Tabs = { ids: ['1'], active: '1' };
    const { open, host, saved } = setup({
      getTabs: vi.fn(async () => {
        if (refuse) throw new Error('The tabs did not load');
        return stored;
      }),
    });
    await open('2');
    await waitFor(() => expect(tabs()).toHaveLength(1));
    // The read failed, so nothing was written, which would have replaced the stored tabs.
    expect(host.setTabs).not.toHaveBeenCalled();
    refuse = false;
    await open('3');
    await waitFor(() => expect(tabs()).toHaveLength(2));
    expect(host.getTabs).toHaveBeenCalledTimes(2);
    // The tab that opened while the read failed stays, and the tabs are written with the token.
    await waitFor(() => expect(saved().ids).toEqual(['2', '3']));
  });
});

describe('file card', () => {
  it('shows the name, the type and the size with both links', async () => {
    const { open } = setup();
    await open('1');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Notes.docx' })).toBeTruthy());
    expect(screen.getByText('Word document · 265 KB')).toBeTruthy();
    const download = screen.getByRole('link', { name: 'Download' }) as HTMLAnchorElement;
    const canvas = screen.getByRole('link', { name: 'Open in Canvas' }) as HTMLAnchorElement;
    expect(download.href).toBe(`${ORIGIN}/files/1/download`);
    expect(canvas.href).toBe(`${ORIGIN}/courses/7/files/1`);
    for (const link of [download, canvas]) {
      expect(link.target).toBe('_blank');
      expect(link.rel).toContain('noopener');
    }
    expect(document.querySelector('[data-part="viewer-body"]')).toBeTruthy();
  });

  it('links to the plain file path when the file has no course', async () => {
    const { open } = setup();
    await open('2');
    await waitFor(() => expect(screen.getByText('Image · 2 KB')).toBeTruthy());
    expect((screen.getByRole('link', { name: 'Open in Canvas' }) as HTMLAnchorElement).href).toBe(
      `${ORIGIN}/files/2`,
    );
  });

  it('uses the course of the click when the record has none', async () => {
    const { open } = setup();
    await open('2', '9');
    await waitFor(() => expect(screen.getByText('Image · 2 KB')).toBeTruthy());
    expect((screen.getByRole('link', { name: 'Open in Canvas' }) as HTMLAnchorElement).href).toBe(
      `${ORIGIN}/courses/9/files/2`,
    );
  });

  it('shows the error with Retry and Open in Canvas, and loads again on Retry', async () => {
    let fail = true;
    const { open, host } = setup({
      loadFile: vi.fn(async (id: string) => (fail ? undefined : FILES[id])),
    });
    await open('1');
    await waitFor(() => expect(screen.getByText("Couldn't load this file")).toBeTruthy());
    expect(screen.getByRole('link', { name: 'Open in Canvas' })).toBeTruthy();
    expect(tabs()[0]!.getAttribute('title')).toBe('Unavailable file');
    fail = false;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Notes.docx' })).toBeTruthy());
    expect(host.loadFile).toHaveBeenCalledTimes(2);
  });
});

describe('site access', () => {
  it('shows Allow access when the permission is withheld, and asks inside the click', async () => {
    let granted = false;
    const { open, host } = setup({
      hasAccess: vi.fn(async () => granted),
      requestAccess: vi.fn(async () => {
        granted = true;
        return true;
      }),
    });
    await open('1');
    const allow = await screen.findByRole('button', { name: 'Allow access' });
    expect(screen.getByRole('link', { name: 'Open in Canvas' })).toBeTruthy();
    await act(async () => {
      fireEvent.click(allow);
      // The request starts in the same turn as the click.
      expect(host.requestAccess).toHaveBeenCalledOnce();
    });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Allow access' })).toBeNull());
    expect(host.loadFile).toHaveBeenCalledTimes(2);
  });

  it('hides Allow access when the permission is granted', async () => {
    const { open } = setup();
    await open('1');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Notes.docx' })).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Allow access' })).toBeNull();
  });
});
