import { describe, expect, it, vi } from 'vitest';
import {
  acceptPaneHello,
  acceptViewerConnect,
  bindViewerPort,
  createViewerSecret,
  helloMessage,
  isExtensionOrigin,
  secretMessage,
  validOpenFile,
  validFullView,
  validPaneReady,
  validPaneRequest,
  validTheme,
} from './channel';
import { linkName } from './model';

const secret = 'a'.repeat(64);
const open = { type: 'open-file', fileId: '42', courseId: '12' };

describe('viewer identities', () => {
  it('accepts file and course ids', () => {
    expect(validOpenFile(open)).toBe(true);
    expect(validOpenFile({ type: 'open-file', fileId: '42' })).toBe(true);
    expect(validOpenFile({ type: 'open-file', fileId: '45~678', courseId: '12~345' })).toBe(true);
  });
  it('rejects addresses and extra fields', () => {
    for (const field of ['fileId', 'courseId']) {
      for (const value of [
        'https://school.edu/files/42',
        '//school.edu/files/42',
        '/files/42',
        '12~',
        '~12',
        '1~2~3',
      ]) {
        expect(validOpenFile({ ...open, [field]: value })).toBe(false);
      }
    }
    expect(validOpenFile({ ...open, url: 'https://school.edu/files/42' })).toBe(false);
    expect(validOpenFile({ ...open, nonce: 'x' })).toBe(false);
  });
  it('accepts the address of a link that carried a verifier, and nothing that is not a web address', () => {
    const address = 'https://school.edu/courses/12/files/42?verifier=abc';
    expect(validOpenFile({ ...open, address })).toBe(true);
    for (const bad of [
      42,
      '',
      '/courses/12/files/42?verifier=abc',
      'javascript:alert(1)',
      'ftp://school.edu/files/42',
      `${address}${'a'.repeat(2000)}`,
    ]) {
      expect(validOpenFile({ ...open, address: bad })).toBe(false);
    }
  });
  it('accepts a comment attachment route and the clean name of its link', () => {
    const fileId = '/courses/12~3/assignments/7/submissions/8?comment_id=9&download=45~6';
    expect(validOpenFile({ type: 'open-file', fileId })).toBe(true);
    expect(validOpenFile({ type: 'open-file', fileId, name: 'Feedback.pdf' })).toBe(true);
    expect(validOpenFile({ type: 'open-file', fileId: '42', name: 'a.pdf' })).toBe(true);
  });
  it('takes the name that the page script makes from a long link text with a space at the cut', () => {
    const name = linkName(`${'a'.repeat(199)} ${'b'.repeat(50)}`);
    expect(name).toBeDefined();
    expect(validOpenFile({ type: 'open-file', fileId: '42', name })).toBe(true);
  });
  it('rejects other routes, and names that are not clean', () => {
    const fileId = '/courses/12/assignments/7/submissions/8?comment_id=9&download=45';
    for (const bad of [
      `https://school.edu${fileId}`,
      `${fileId}&x=1`,
      fileId.replace('/submissions/8', '/submissions/8/extra'),
      fileId.replace('comment_id=9&download=45', 'download=45&comment_id=9'),
    ])
      expect(validOpenFile({ type: 'open-file', fileId: bad })).toBe(false);
    for (const name of [' a', 'a\nb', 'a\u0000', 'a'.repeat(201), 7, '']) {
      expect(validOpenFile({ type: 'open-file', fileId, name })).toBe(false);
    }
  });
  it('creates random 256 bit secrets', () => {
    const first = createViewerSecret();
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(createViewerSecret()).not.toBe(first);
  });
});

describe('viewer theme', () => {
  const theme = { type: 'theme', theme: 'dark' };
  it('accepts the light and dark themes', () => {
    expect(validTheme(theme)).toBe(true);
    expect(validTheme({ ...theme, theme: 'light' })).toBe(true);
  });
  it('rejects other values and extra fields', () => {
    for (const value of ['auto', 'DARK', '', undefined, 1, null, {}]) {
      expect(validTheme({ ...theme, theme: value })).toBe(false);
    }
    expect(validTheme({ ...theme, color: 'red' })).toBe(false);
    expect(validTheme(null)).toBe(false);
  });
});

describe('full view messages', () => {
  it('accepts the state of the Canvas page, and nothing with another shape', () => {
    expect(validFullView({ type: 'full-view', on: true, available: false })).toBe(true);
    for (const bad of [
      { type: 'full-view', on: 'yes', available: true },
      { type: 'full-view', on: true },
      { type: 'full-view', on: true, available: true, url: 'https://school.edu' },
      { type: 'theme', on: true, available: true },
      null,
    ])
      expect(validFullView(bad)).toBe(false);
  });
  it('accepts the three requests of the pane page, and nothing with another shape', () => {
    for (const good of [
      { type: 'close' },
      { type: 'escape' },
      { type: 'full-view', on: true },
      { type: 'full-view', on: false },
    ])
      expect(validPaneRequest(good)).toBe(true);
    for (const bad of [
      { type: 'close', fileId: '1' },
      { type: 'escape', on: true },
      { type: 'full-view' },
      { type: 'full-view', on: 1 },
      { type: 'full-view', on: true, available: true },
      { type: 'open-file', fileId: '1' },
      'close',
      null,
    ])
      expect(validPaneRequest(bad)).toBe(false);
  });
});

describe('extension origins', () => {
  it('accepts the origin of an extension page and nothing else', () => {
    expect(isExtensionOrigin('chrome-extension://abcdef')).toBe(true);
    expect(isExtensionOrigin('moz-extension://1234-5678')).toBe(true);
    for (const origin of ['https://school.edu', 'null', '', 'chrome-extension://a/b', 'http://a']) {
      expect(isExtensionOrigin(origin)).toBe(false);
    }
  });
});

describe('hello from the pane', () => {
  const pane = {} as Window;
  const hello = (overrides: Partial<MessageEvent> = {}, id = 'abcdefghij') =>
    acceptPaneHello(
      {
        source: pane,
        origin: 'chrome-extension://abc',
        data: helloMessage('abcdefghij'),
        ...overrides,
      } as MessageEvent,
      pane,
      id,
    );
  it('gives back the origin of the frame', () => {
    expect(hello()).toBe('chrome-extension://abc');
  });
  it('ignores another window, a web page origin and a hello with more in it', () => {
    expect(hello({ source: {} as Window })).toBeNull();
    expect(hello({ origin: 'https://evil.example' })).toBeNull();
    expect(hello({ data: { ...helloMessage('abcdefghij'), secret } })).toBeNull();
    expect(hello({ data: { type: 'other', extensionId: 'abcdefghij' } })).toBeNull();
    expect(hello({ data: null })).toBeNull();
    expect(
      acceptPaneHello(
        { source: pane, origin: 'chrome-extension://abc', data: helloMessage('abcdefghij') },
        null,
        'abcdefghij',
      ),
    ).toBeNull();
  });
  it('ignores a page of another extension', () => {
    expect(
      hello({ data: helloMessage('another-extension'), origin: 'moz-extension://x' }),
    ).toBeNull();
    expect(hello({ data: { type: 'viewer-hello' } })).toBeNull();
    expect(hello({}, '')).toBeNull();
  });
  it('trusts the answer of the pane only with the secret', () => {
    expect(validPaneReady({ type: 'ready', secret }, secret)).toBe(true);
    expect(validPaneReady({ type: 'ready', secret: 'b'.repeat(64) }, secret)).toBe(false);
    expect(validPaneReady({ type: 'ready' }, secret)).toBe(false);
    expect(validPaneReady({ type: 'secret', secret }, secret)).toBe(false);
    expect(validPaneReady({ type: 'ready', secret, extra: 1 }, secret)).toBe(false);
    expect(validPaneReady({ type: 'ready', secret }, 'short')).toBe(false);
  });
});

function fakePort() {
  let listener: ((event: { data: unknown }) => void) | undefined;
  return {
    addEventListener: vi.fn((_: string, next: typeof listener) => (listener = next)),
    removeEventListener: vi.fn(() => (listener = undefined)),
    start: vi.fn(),
    close: vi.fn(),
    postMessage: vi.fn(),
    deliver: (data: unknown) => listener?.({ data }),
  };
}

describe('port of the pane', () => {
  const parent = {} as Window;
  function connect(overrides: Partial<MessageEvent> = {}) {
    const port = fakePort();
    const event = {
      origin: 'https://school.edu',
      source: parent,
      data: { type: 'viewer-connect' },
      ports: [port],
      ...overrides,
    } as unknown as MessageEvent;
    return { port, offered: acceptViewerConnect(event, 'https://school.edu', parent) };
  }
  it('takes a port only from the parent at the saved origin, with a bare connect message', () => {
    expect(connect().offered).not.toBeNull();
    for (const override of [
      { origin: 'https://other.edu' },
      { source: {} as Window },
      { data: { type: 'viewer-connect', nonce: 'x' } },
      { data: { type: 'viewer-connect', secret } },
      { ports: [] },
    ]) {
      expect(connect(override).offered).toBeNull();
    }
  });
  it('never sends first, and drops a port whose first message has no right secret', () => {
    for (const first of [{ type: 'open-file', fileId: '1' }, secretMessage('b'.repeat(64)), null]) {
      const { port } = connect();
      const receive = vi.fn();
      bindViewerPort(port as unknown as MessagePort, secret, { receive, bound: vi.fn() });
      expect(port.postMessage).not.toHaveBeenCalled();
      port.deliver(first);
      expect(port.close).toHaveBeenCalledOnce();
      expect(port.postMessage).not.toHaveBeenCalled();
      expect(receive).not.toHaveBeenCalled();
    }
  });
  it('answers the right secret, then passes on valid messages only', () => {
    const { port } = connect();
    const receive = vi.fn();
    const bound = vi.fn();
    const unbind = bindViewerPort(port as unknown as MessagePort, secret, { receive, bound });
    port.deliver(secretMessage(secret));
    expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'ready', secret });
    expect(bound).toHaveBeenCalledOnce();
    port.deliver({ ...open, fileId: 'https://school.edu/files/42' });
    port.deliver({ type: 'theme', theme: 'blue' });
    expect(receive).not.toHaveBeenCalled();
    port.deliver(open);
    port.deliver({ type: 'theme', theme: 'light' });
    expect(receive).toHaveBeenNthCalledWith(1, open);
    expect(receive).toHaveBeenNthCalledWith(2, { type: 'theme', theme: 'light' });
    port.deliver({ type: 'full-view', on: true, available: 'yes' });
    port.deliver({ type: 'full-view', on: true, available: true });
    expect(receive).toHaveBeenCalledTimes(3);
    expect(receive).toHaveBeenNthCalledWith(3, { type: 'full-view', on: true, available: true });
    unbind();
    expect(port.close).toHaveBeenCalledOnce();
  });
});
