import { describe, expect, it, vi } from 'vitest';
import {
  acceptPaneHello,
  acceptViewerConnect,
  bindViewerPort,
  createViewerSecret,
  helloMessage,
  isExtensionOrigin,
  answerPaneProof,
  validOpenFile,
  validCovered,
  validFullView,
  viewerProof,
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

describe('covered messages', () => {
  it('accepts the state of the file pane, and nothing with another shape', () => {
    expect(validCovered({ type: 'covered', covered: true })).toBe(true);
    expect(validCovered({ type: 'covered', covered: false })).toBe(true);
    for (const bad of [
      { type: 'covered' },
      { type: 'covered', covered: 'yes' },
      { type: 'covered', covered: true, url: 'https://school.edu' },
      { type: 'theme', covered: true },
      null,
    ])
      expect(validCovered(bad)).toBe(false);
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
});

const nonce = 'd'.repeat(32);
function fakePort() {
  const events = new EventTarget();
  return {
    addEventListener: events.addEventListener.bind(events),
    start: vi.fn(),
    close: vi.fn(),
    postMessage: vi.fn(),
    deliver: (data: unknown) => events.dispatchEvent(new MessageEvent('message', { data })),
  };
}

describe('port of the pane', () => {
  const parent = {} as Window;
  function connect(overrides: Partial<MessageEvent> = {}) {
    const port = fakePort();
    const event = {
      origin: 'https://school.edu',
      source: parent,
      data: { type: 'viewer-connect', nonce },
      ports: [port],
      ...overrides,
    } as unknown as MessageEvent;
    return { port, offered: acceptViewerConnect(event, 'https://school.edu', parent) };
  }

  it('takes a port only from the parent at the saved origin with a fixed-length nonce', () => {
    const { port, offered } = connect();
    expect(offered).toEqual({ port, nonce });
    for (const override of [
      { origin: 'https://other.edu' },
      { source: {} as Window },
      { data: { type: 'viewer-connect', nonce: 'x' } },
      { data: { type: 'viewer-connect', secret } },
      { data: { type: 'viewer-connect', nonce, extra: true } },
      { ports: [] },
    ]) {
      expect(connect(override).offered).toBeNull();
    }
  });

  it.each([
    null,
    { type: 'open-file', fileId: '1' },
    { type: 'page-proof', proof: '0'.repeat(64) },
  ])('closes a port with an invalid first message: %j', async (first) => {
    const { port, offered } = connect();
    const receive = vi.fn();
    const bound = vi.fn(() => true);
    await bindViewerPort(offered!.port, secret, nonce, { receive, bound });
    expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({
      type: 'pane-proof',
      nonce: expect.stringMatching(/^[0-9a-f]{32}$/),
      proof: await viewerProof('pane', secret, nonce),
    });
    port.deliver(first);
    port.deliver(open);
    expect(port.close).toHaveBeenCalledOnce();
    expect(bound).not.toHaveBeenCalled();
    expect(receive).not.toHaveBeenCalled();
  });

  it('checks both proofs against their own challenge and passes only valid messages', async () => {
    const { port, offered } = connect();
    const receive = vi.fn();
    const bound = vi.fn(() => true);
    await bindViewerPort(offered!.port, secret, nonce, { receive, bound });
    const [challenge] = port.postMessage.mock.calls[0]!;
    await expect(answerPaneProof(challenge, secret, 'e'.repeat(32))).resolves.toBeUndefined();
    await expect(
      answerPaneProof({ ...challenge, extra: true }, secret, nonce),
    ).resolves.toBeUndefined();
    const proof = await answerPaneProof(challenge, secret, nonce);
    expect(proof).toMatch(/^[0-9a-f]{64}$/);
    expect(proof).not.toBe(challenge.proof);
    port.deliver({ type: 'page-proof', proof });
    port.deliver({ type: 'page-proof', proof });
    expect(bound).toHaveBeenCalledOnce();
    expect(port.close).not.toHaveBeenCalled();
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
    port.deliver({ type: 'covered', covered: 'yes' });
    port.deliver({ type: 'covered', covered: true });
    expect(receive).toHaveBeenCalledTimes(4);
    expect(receive).toHaveBeenNthCalledWith(4, { type: 'covered', covered: true });
  });
});
