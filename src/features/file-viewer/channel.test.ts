import { describe, expect, it, vi } from 'vitest';
import { acceptViewerChannel, createViewerNonce, validOpenFile } from './channel';

const nonce = 'a'.repeat(32);
const open = { type: 'open-file', nonce, fileId: '42', courseId: '12' };

describe('viewer identities', () => {
  it('accepts file and course ids', () => {
    expect(validOpenFile(open, nonce)).toBe(true);
    expect(validOpenFile({ type: 'open-file', nonce, fileId: '42' }, nonce)).toBe(true);
  });
  it('rejects addresses and extra fields', () => {
    for (const field of ['fileId', 'courseId']) {
      for (const value of ['https://school.edu/files/42', '//school.edu/files/42', '/files/42']) {
        expect(validOpenFile({ ...open, [field]: value }, nonce)).toBe(false);
      }
    }
    expect(validOpenFile({ ...open, url: 'https://school.edu/files/42' }, nonce)).toBe(false);
  });
  it('rejects a wrong or absent nonce', () => {
    expect(validOpenFile({ ...open, nonce: 'b'.repeat(32) }, nonce)).toBe(false);
    expect(validOpenFile({ ...open, nonce: undefined }, nonce)).toBe(false);
    expect(validOpenFile(open, '')).toBe(false);
  });
  it('creates random 128 bit nonces', () => {
    const first = createViewerNonce();
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(createViewerNonce()).not.toBe(first);
  });
});

describe('viewer channel', () => {
  const parent = {} as Window;
  function setup(overrides: Partial<MessageEvent> = {}) {
    const port = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      start: vi.fn(),
      close: vi.fn(),
    };
    const event = {
      origin: 'https://school.edu',
      source: parent,
      data: { type: 'viewer-connect', nonce },
      ports: [port],
      ...overrides,
    } as unknown as MessageEvent;
    const receive = vi.fn();
    const close = acceptViewerChannel(event, 'https://school.edu', parent, nonce, receive);
    return { port, receive, close };
  }
  it('rejects another origin, source, nonce, or port count', () => {
    for (const override of [
      { origin: 'https://other.edu' },
      { source: {} as Window },
      { data: { type: 'viewer-connect', nonce: 'b'.repeat(32) } },
      { ports: [] },
    ]) {
      const { port, close } = setup(override);
      expect(close).toBeNull();
      expect(port.start).not.toHaveBeenCalled();
    }
  });
  it('filters port messages and closes the port on cleanup', () => {
    const { port, receive, close } = setup();
    expect(port.start).toHaveBeenCalledOnce();
    const listener = port.addEventListener.mock.calls[0]![1] as (event: { data: unknown }) => void;
    listener({ data: { ...open, nonce: 'wrong' } });
    listener({ data: { ...open, fileId: 'https://school.edu/files/42' } });
    expect(receive).not.toHaveBeenCalled();
    listener({ data: open });
    expect(receive).toHaveBeenCalledWith(open);
    close!();
    expect(port.removeEventListener).toHaveBeenCalledWith('message', listener);
    expect(port.close).toHaveBeenCalledOnce();
  });
});
