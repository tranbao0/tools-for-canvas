// @vitest-environment happy-dom
// The page and pane share one store with requests ordered by the background.
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tabIntentReply } from './tabIntent.fixture';
import { normalizeTabs } from './model';
import { startViewer } from './page';
import { createCoveredStore } from './ui/covered';
import { createFullViewStore } from './ui/fullView';
import { createOpenSource } from './ui/openSource';
import { ViewerApp } from './ui/ViewerApp';

const identity = vi.hoisted(() => ({ confirmed: true }));
const SECRET = 'c'.repeat(64);
const { sendMessage, addListener, removeListener } = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
}));
vi.mock('wxt/browser', () => ({
  browser: {
    runtime: {
      id: 'my-extension',
      getURL: () => '',
      sendMessage,
      onMessage: { addListener, removeListener },
    },
  },
}));
vi.mock('./channel', async (original) => ({
  ...(await original<typeof import('./channel')>()),
  acceptPaneHello: (event: MessageEvent) =>
    (event.data as { type?: string })?.type === 'viewer-hello' ? 'chrome-extension://x' : null,
  validPaneReady: () => true,
}));
vi.mock('./paneIdentity', () => ({
  watchPaneIdentity: (show: (yes: boolean) => void) => {
    show(identity.confirmed);
    return () => undefined;
  },
  checkPaneIdentity: async () => ({ verdict: 'unknown' }),
  retryPaneIdentity: async () => undefined,
}));

type Tabs = { ids: string[]; active: string | null };
type Msg = { type: string; [key: string]: unknown };
const bg = {
  user: 'A',
  epoch: 0,
  store: { ids: [] as string[], active: null as string | null, user: 'A' },
  log: [] as string[],
  failGets: 0,
  hold: undefined as
    | { when(m: Msg, from: string): boolean; gate: Promise<void>; release(): void; hit: boolean }
    | undefined,
};
let fifo: Promise<unknown> = Promise.resolve();
const tok = () => `${bg.epoch}:${bg.user}`;
const current = (): Tabs =>
  bg.store.user === bg.user
    ? { ids: [...bg.store.ids], active: bg.store.active }
    : { ids: [], active: null };
function background(m: Msg, from: 'page' | 'pane'): Promise<unknown> {
  if (m.type === 'weekrow:page-context')
    return Promise.resolve({ tools: { fileViewer: true, fileViewerWidth: 480 }, settings: {} });
  if (m.type === 'viewer:session') return Promise.resolve({ secret: SECRET });
  if (typeof m.type !== 'string' || !m.type.startsWith('viewer:tabs-'))
    return Promise.resolve({ ok: true });
  const run = async () => {
    const action = m.type.slice(12);
    if (bg.hold && !bg.hold.hit && bg.hold.when(m, from)) {
      bg.hold.hit = true;
      bg.log.push(
        `HOLD ${from} ${action} ${action === 'set' ? JSON.stringify(m.tabs) : (m.fileId ?? '')}`,
      );
      await bg.hold.gate;
    }
    if (action === 'get') {
      if (bg.failGets > 0) {
        bg.failGets--;
        bg.log.push(`${from} get FAILED`);
        throw new Error('unconfirmed');
      }
      bg.log.push(`${from} get ${tok()}`);
      return { ...current(), token: tok() };
    }
    const ok = m.token === tok();
    const detail =
      action === 'set'
        ? JSON.stringify(m.tabs)
        : action === 'undo'
          ? JSON.stringify({ added: m.added, evicted: m.evicted })
          : (m.fileId ?? '');
    bg.log.push(`${from} ${action} ${detail} ${m.token} ${ok ? 'OK' : 'REFUSED'} as ${bg.user}`);
    if (!ok) throw new Error('refused');
    const reply = tabIntentReply(m, current());
    bg.store = { ids: reply.ids, active: reply.active, user: bg.user };
    return reply;
  };
  const result = fifo.then(run, run);
  fifo = result.catch(() => undefined);
  return result;
}

type Pane = {
  dead: boolean;
  token: string | undefined;
  port: { onmessage: ((m: { data: unknown }) => void) | null } | undefined;
  opens: ReturnType<typeof createOpenSource>;
  covered: ReturnType<typeof createCoveredStore>;
  container: Element;
  receive(m: Msg): void;
};
const panes: Pane[] = [];
function newPane(): Pane {
  for (const p of panes) p.dead = true;
  cleanup();
  const pane = {
    dead: false,
    token: undefined,
    port: undefined,
    opens: createOpenSource(),
    covered: createCoveredStore(),
    container: undefined as unknown as Element,
    receive(m: Msg) {
      if (pane.dead) return;
      if (m.type === 'open-file') {
        const { type: _type, ...request } = m;
        pane.opens.emit({
          ...request,
          fileId: String(m.fileId),
          token: typeof m.token === 'string' ? m.token : undefined,
        });
      } else if (m.type === 'covered') pane.covered.receive(m.covered === true);
    },
  } as Pane;
  const call = (m: Msg) =>
    pane.dead ? new Promise<never>(() => undefined) : background(m, 'pane');
  const host = {
    origin: 'https://school.instructure.com',
    loadFile: async (id: string) => ({
      name: `F${id}`,
      contentType: 'image/png',
      size: 10,
      url: `/files/${id}/download`,
      courseId: null,
    }),
    hasAccess: async () => true,
    requestAccess: async () => true,
    async getTabs() {
      const reply = (await call({ type: 'viewer:tabs-get' })) as Msg;
      if (typeof reply !== 'object' || reply === null) throw new Error('The tabs did not load');
      pane.token = typeof reply.token === 'string' ? reply.token : undefined;
      return normalizeTabs(reply);
    },
    tabToken: () => pane.token,
    async changeTabs(intent: import('./model').TabIntent, token: string) {
      const { action, ...data } = intent;
      const reply = await call({ type: 'viewer:tabs-' + action, ...data, token });
      if (!reply || typeof reply !== 'object') throw new Error('The tabs did not save');
      return normalizeTabs(reply);
    },
    closePane: () => pane.port?.onmessage?.({ data: { type: 'close' } }),
    fullView: createFullViewStore(vi.fn()),
    covered: pane.covered,
    readFile: () => new Promise<Uint8Array>(() => undefined),
    loadPdfjs: () => new Promise<never>(() => undefined),
  };
  pane.container = render(<ViewerApp host={host} opens={pane.opens} />).container;
  panes.push(pane);
  return pane;
}

const ports: {
  postMessage: ReturnType<typeof vi.fn>;
  close(): void;
  onmessage: ((m: { data: unknown }) => void) | null;
}[] = [];
class FakeChannel {
  port1: {
    postMessage: ReturnType<typeof vi.fn>;
    close(): void;
    onmessage: ((m: { data: unknown }) => void) | null;
  };
  port2 = {};
  constructor() {
    const pane = newPane();
    this.port1 = { postMessage: vi.fn((m: Msg) => pane.receive(m)), close() {}, onmessage: null };
    pane.port = this.port1;
    ports.push(this.port1);
  }
}
vi.stubGlobal('MessageChannel', FakeChannel);

const scope = globalThis as typeof globalThis & { __weekrowViewer?: () => void };
afterEach(() => {
  identity.confirmed = true;
  scope.__weekrowViewer?.();
  delete scope.__weekrowViewer;
  for (const p of panes) p.dead = true;
  cleanup();
  vi.restoreAllMocks();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 40));
const settled = async (n = 3) => {
  for (let i = 0; i < n; i++) await settle();
};
const click = (id: string) => {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
  Object.defineProperty(event, 'isTrusted', { value: true });
  document.getElementById(id)!.dispatchEvent(event);
};
async function connect() {
  window.dispatchEvent(new MessageEvent('message', { data: { type: 'viewer-hello' } }));
  await settle();
  ports.at(-1)!.onmessage!({ data: {} });
  await settled();
}
const live = () => panes.filter((p) => !p.dead).at(-1);
const shown = () => {
  const pane = live();
  if (!pane) return null;
  return [...pane.container.querySelectorAll('button[role="tab"][data-file-id]')].map(
    (b) =>
      b.getAttribute('data-file-id')! + (b.getAttribute('aria-selected') === 'true' ? '*' : ''),
  );
};
const tabButton = (id: string) =>
  live()!.container.querySelector<HTMLElement>(`button[role="tab"][data-file-id="${id}"]`)!;
const activateTab = (id: string) => fireEvent.click(tabButton(id));
const closeTab = (id: string) =>
  fireEvent.click(tabButton(id).closest('.fv-tab')!.querySelector<HTMLElement>('.fv-tab-close')!);
const hosts = () => document.querySelectorAll('#tools-file-viewer').length;
const LINKS =
  '<a id="l5" href="/files/5">A</a><a id="l6" href="/files/6">B</a><a id="l7" href="/files/7">C</a>';
let clickGuard = false;
function setup(initial: Tabs) {
  document.body.innerHTML = LINKS;
  if (!clickGuard) {
    document.addEventListener('click', (event) => event.preventDefault());
    clickGuard = true;
  }
  bg.user = 'A';
  bg.epoch = 0;
  bg.store = { ...initial, user: 'A' };
  bg.log = [];
  bg.failGets = 0;
  bg.hold = undefined;
  fifo = Promise.resolve();
  ports.length = 0;
  sendMessage.mockImplementation((m: Msg) => background(m, 'page'));
}
async function nextPage() {
  scope.__weekrowViewer?.();
  delete scope.__weekrowViewer;
  for (const p of panes) p.dead = true;
  cleanup();
  document.body.innerHTML = LINKS;
  await startViewer();
  await settle();
  if (hosts() > 0) await connect();
  return { hosts: hosts(), shown: shown(), store: { ids: bg.store.ids, active: bg.store.active } };
}
function hold(when: (m: Msg, from: string) => boolean) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  bg.hold = { when, gate, release, hit: false };
  return () => release();
}
describe('page and pane persistence after reconnects and queued actions', () => {
  it('A1 removed host, then a click on a file the page saved earlier', async () => {
    setup({ ids: ['4'], active: '4' });
    await startViewer();
    await connect();
    click('l5');
    await settled();
    click('l6');
    await settled();
    document.getElementById('tools-file-viewer')!.remove();
    click('l5');
    await settled();
    await connect();
    await settled();
    const next = await nextPage();
    expect(next, bg.log.join('\n')).toEqual({
      hosts: 1,
      shown: ['4', '5*', '6'],
      store: { ids: ['4', '5', '6'], active: '5' },
    });
  });

  it('A3 removed host, the page read fails, and the store lost the file the page saved earlier', async () => {
    setup({ ids: ['4'], active: '4' });
    await startViewer();
    await connect();
    click('l5');
    await settled();
    closeTab('5');
    await settled();
    document.getElementById('tools-file-viewer')!.remove();
    bg.failGets = 1;
    click('l5');
    await settled();
    await connect();
    await settled();
    const next = await nextPage();
    expect(next, bg.log.join('\n')).toEqual({
      hosts: 1,
      shown: ['4', '5*'],
      store: { ids: ['4', '5'], active: '5' },
    });
  });

  it('A4 Close under the cover, then the same file again once the identity is confirmed', async () => {
    identity.confirmed = false;
    setup({ ids: ['4', '5'], active: '4' });
    await startViewer();
    await connect();
    click('l5');
    await settled();
    ports.at(-1)!.onmessage!({ data: { type: 'close' } });
    await settled();
    identity.confirmed = true;
    click('l5');
    await settled();
    await connect();
    await settled();
    const next = await nextPage();
    expect(next, bg.log.join('\n')).toEqual({
      hosts: 1,
      shown: ['4', '5*'],
      store: { ids: ['4', '5'], active: '5' },
    });
  });

  it('B a page open while a pane close waits behind a slow pane write', async () => {
    setup({ ids: ['4', '5'], active: '5' });
    await startViewer();
    await connect();
    const release = hold((m, from) => from === 'pane' && m.type !== 'viewer:tabs-get');
    activateTab('4');
    await settle();
    closeTab('5');
    await settle();
    click('l5');
    await settled();
    release();
    await settled(5);
    const next = await nextPage();
    expect(next, bg.log.join('\n')).toEqual({
      hosts: 1,
      shown: ['4', '5*'],
      store: { ids: ['4', '5'], active: '5' },
    });
  });
});
