// @vitest-environment happy-dom
// A write that finishes late must not undo a later change of the same tab.
import { applyTabIntent, type TabIntent, type Tabs } from '../model';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PdfjsLib } from '../pdf/types';
import type { PaneFile } from './FileCard';
import { createCoveredStore } from './covered';
import { createFullViewStore } from './fullView';
import { createOpenSource } from './openSource';
import { ViewerApp, type PaneHost } from './ViewerApp';

afterEach(cleanup);

const file = (id: string): PaneFile => ({
  name: `File${id}.png`,
  contentType: 'image/png',
  size: 10,
  url: `/files/${id}/download`,
  courseId: null,
});

type Gate = { resolve(): void; reject(): void; promise: Promise<void> };
function gate(): Gate {
  let resolve!: () => void;
  let reject!: () => void;
  const promise = new Promise<void>((ok, no) => {
    resolve = ok;
    reject = () => no(new Error('refused'));
  });
  return { resolve, reject, promise };
}

function mount(
  initial: Tabs,
  plan: (intent: TabIntent, token: string, n: number) => Promise<void> | void,
  token: () => string | undefined = () => 'T',
) {
  let stored = initial;
  let n = 0;
  const calls: { intent: TabIntent; token: string }[] = [];
  const host: PaneHost = {
    origin: 'https://school.instructure.com',
    loadFile: vi.fn(async (id: string) => file(id)),
    hasAccess: vi.fn(async () => true),
    requestAccess: vi.fn(async () => true),
    getTabs: vi.fn(async () => stored),
    tabToken: token,
    changeTabs: vi.fn(async (intent: TabIntent, t: string) => {
      calls.push({ intent, token: t });
      await plan(intent, t, ++n);
      stored = applyTabIntent(stored, intent);
      return stored;
    }),
    closePane: vi.fn(),
    fullView: createFullViewStore(vi.fn()),
    covered: createCoveredStore(),
    readFile: vi.fn(() => new Promise<Uint8Array>(() => undefined)),
    loadPdfjs: vi.fn(() => new Promise<PdfjsLib>(() => undefined)),
  };
  const opens = createOpenSource();
  render(<ViewerApp host={host} opens={opens} />);
  return {
    opens,
    calls,
    stored: () => stored,
    setStored: (next: Tabs) => {
      stored = next;
    },
  };
}
const ids = () => screen.queryAllByRole('tab').map((tab) => tab.getAttribute('data-file-id'));
const activeId = () =>
  screen
    .queryAllByRole('tab')
    .find((tab) => tab.getAttribute('aria-selected') === 'true')
    ?.getAttribute('data-file-id') ?? null;
const tab = (id: string) =>
  screen.getAllByRole('tab').find((t) => t.getAttribute('data-file-id') === id)!;
const closeButton = (id: string) => screen.getByRole('button', { name: `Close File${id}.png` });
const settle = async () => {
  for (let i = 0; i < 10; i += 1) await act(async () => new Promise((r) => setTimeout(r, 0)));
};

describe('writes that finish after a later change of the same tab', () => {
  it('keeps a tab that the student opened again without a token while its close was saving', async () => {
    const held = gate();
    const app = mount({ ids: ['1', '3'], active: '1' }, async (intent) => {
      if (intent.action === 'close' && intent.fileId === '2') await held.promise;
    });
    await act(async () => app.opens.emit({ fileId: '1', token: 'T' }));
    await waitFor(() => expect(ids()).toEqual(['1', '3']));
    // A memory-only tab (tokenless open).
    await act(async () => app.opens.emit({ fileId: '2' }));
    await waitFor(() => expect(ids()).toEqual(['1', '3', '2']));
    await settle();
    await act(async () => {
      fireEvent.click(closeButton('2'));
    });
    await waitFor(() => expect(ids()).toEqual(['1', '3']));
    // The student opens it again from a page link without a token while the close write runs.
    await act(async () => app.opens.emit({ fileId: '2' }));
    await waitFor(() => expect(ids()).toEqual(['1', '3', '2']));
    held.resolve();
    await settle();
    await act(async () => {
      fireEvent.click(tab('1'));
    });
    await settle();
    expect(ids()).toEqual(['1', '3', '2']);
  });

  it('keeps a tab that the student opened again without a token when its earlier close fails', async () => {
    const held = gate();
    const app = mount({ ids: ['1', '2', '3'], active: '1' }, async (intent) => {
      if (intent.action === 'close' && intent.fileId === '2') await held.promise;
    });
    await act(async () => app.opens.emit({ fileId: '1', token: 'T' }));
    await waitFor(() => expect(ids()).toEqual(['1', '2', '3']));
    await settle();
    await act(async () => {
      fireEvent.click(closeButton('2'));
    });
    await waitFor(() => expect(ids()).toEqual(['1', '3']));
    await act(async () => app.opens.emit({ fileId: '2' }));
    await waitFor(() => expect(ids()).toEqual(['1', '3', '2']));
    held.reject();
    await settle();
    await act(async () => {
      fireEvent.click(tab('3'));
    });
    await settle();
    expect(ids()).toEqual(['1', '3', '2']);
  });

  it('keeps the active tab among the tabs after failed writes and a later close', async () => {
    const held = gate();
    let failActivate = false;
    const app = mount({ ids: ['1', '2', '3'], active: '1' }, async (intent) => {
      if (intent.action === 'close' && intent.fileId === '2') {
        await held.promise;
      }
      if (failActivate && intent.action === 'activate' && intent.fileId === '2') {
        failActivate = false;
        throw new Error('refused');
      }
    });
    await act(async () => app.opens.emit({ fileId: '1', token: 'T' }));
    await waitFor(() => expect(ids()).toEqual(['1', '2', '3']));
    await settle();
    await act(async () => {
      fireEvent.click(closeButton('2'));
    });
    await act(async () => app.opens.emit({ fileId: '2' }));
    await waitFor(() => expect(ids()).toEqual(['1', '3', '2']));
    await act(async () => {
      fireEvent.click(tab('1'));
    });
    failActivate = true;
    await act(async () => {
      fireEvent.click(tab('2'));
    });
    held.reject();
    await settle();
    await act(async () => {
      fireEvent.click(closeButton('3'));
    });
    await settle();
    expect(ids()).toEqual(['1', '2']);
    expect(activeId()).not.toBeNull();
    const panel = document.querySelector('[role=tabpanel]');
    expect(document.getElementById(panel?.getAttribute('aria-labelledby') ?? '')).not.toBeNull();
  });
  it('keeps a tab whose saved open fails after the page opened it again without a token', async () => {
    const held = gate();
    const app = mount({ ids: ['1', '3'], active: '1' }, async (intent) => {
      if (intent.action === 'open' && intent.fileId === '2') {
        await held.promise;
      }
    });
    await act(async () => app.opens.emit({ fileId: '1', token: 'T' }));
    await waitFor(() => expect(ids()).toEqual(['1', '3']));
    await settle();
    await act(async () => app.opens.emit({ fileId: '2', token: 'T' }));
    await waitFor(() => expect(ids()).toEqual(['1', '3', '2']));
    // The page clicks the same file again, now without a token.
    await act(async () => app.opens.emit({ fileId: '2' }));
    await settle();
    held.reject();
    await settle();
    await act(async () => {
      fireEvent.click(tab('1'));
    });
    await settle();
    expect(ids()).toEqual(['1', '3', '2']);
  });

  it('ends the closed state of a tab when its saved reopen succeeds, also after a tokenless open', async () => {
    const held = gate();
    let failClose = true;
    const app = mount({ ids: ['1', '2', '3'], active: '1' }, async (intent) => {
      if (failClose && intent.action === 'close' && intent.fileId === '2') {
        failClose = false;
        throw new Error('refused');
      }
      if (intent.action === 'open' && intent.fileId === '2') await held.promise;
    });
    await act(async () => app.opens.emit({ fileId: '1', token: 'T' }));
    await waitFor(() => expect(ids()).toEqual(['1', '2', '3']));
    await settle();
    await act(async () => {
      fireEvent.click(closeButton('2'));
    });
    await settle();
    expect(ids()).toEqual(['1', '3']);
    await act(async () => app.opens.emit({ fileId: '2', token: 'T' }));
    await waitFor(() => expect(ids()).toEqual(['1', '3', '2']));
    await act(async () => app.opens.emit({ fileId: '2' }));
    await settle();
    held.resolve();
    await settle();
    await act(async () => {
      fireEvent.click(tab('3'));
    });
    await settle();
    expect(app.stored().ids).toContain('2');
    // The saved store order wins after a failed close; only the tab itself must stay.
    expect([...ids()].sort()).toEqual(['1', '2', '3']);
    // Later writes keep it too.
    await act(async () => {
      fireEvent.click(tab('1'));
    });
    await settle();
    expect([...ids()].sort()).toEqual(['1', '2', '3']);
  });

  it('keeps a tab stored and shown when the page opens it again without a token during its save', async () => {
    const held = gate();
    const app = mount({ ids: ['1', '3'], active: '1' }, async (intent) => {
      if (intent.action === 'open' && intent.fileId === '2') await held.promise;
    });
    await act(async () => app.opens.emit({ fileId: '1', token: 'T' }));
    await waitFor(() => expect(ids()).toEqual(['1', '3']));
    await settle();
    await act(async () => app.opens.emit({ fileId: '2', token: 'T' }));
    await act(async () => app.opens.emit({ fileId: '2' }));
    held.resolve();
    await settle();
    await act(async () => {
      fireEvent.click(tab('1'));
    });
    await settle();
    expect(ids()).toEqual(['1', '3', '2']);
    // Closing it removes it for good.
    await act(async () => {
      fireEvent.click(closeButton('2'));
    });
    await settle();
    await act(async () => {
      fireEvent.click(tab('3'));
    });
    await settle();
    expect(ids()).toEqual(['1', '3']);
    expect(app.stored().ids).toEqual(['1', '3']);
  });
});
