import { describe, expect, it, vi } from 'vitest';
import { listenViewerHello } from './page';

vi.mock('wxt/browser', () => ({ browser: {} }));

describe('viewer hello', () => {
  function setup() {
    const fake = new EventTarget();
    const frame = { contentWindow: {} } as HTMLIFrameElement;
    const connect = vi.fn();
    const remove = listenViewerHello(fake as unknown as Window, frame, 'nonce', connect);
    const hello = (source: unknown, nonce = 'nonce', origin = 'https://dynamic.example') => {
      const event = new Event('message');
      Object.assign(event, { source, origin, data: { type: 'viewer-hello', nonce } });
      fake.dispatchEvent(event);
    };
    return { frame, connect, remove, hello };
  }
  it('ignores another source', () => {
    const { hello, connect } = setup();
    hello({});
    expect(connect).not.toHaveBeenCalled();
  });
  it('ignores a wrong nonce', () => {
    const { hello, connect, frame } = setup();
    hello(frame.contentWindow, 'wrong');
    expect(connect).not.toHaveBeenCalled();
  });
  it('replies only to the event origin and removes the listener', () => {
    const { hello, connect, frame, remove } = setup();
    hello(frame.contentWindow);
    expect(connect).toHaveBeenCalledExactlyOnceWith('https://dynamic.example');
    remove();
    hello(frame.contentWindow);
    expect(connect).toHaveBeenCalledTimes(1);
  });
});
