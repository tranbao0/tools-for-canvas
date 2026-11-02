import { describe, expect, it, vi } from 'vitest';
import { listenViewerHello } from './page';

vi.mock('wxt/browser', () => ({ browser: {} }));

describe('viewer hello', () => {
  function setup() {
    const fake = new EventTarget();
    const frame = { contentWindow: {} } as HTMLIFrameElement;
    const connect = vi.fn();
    const remove = listenViewerHello(fake as unknown as Window, frame, connect);
    const hello = (
      source: unknown,
      origin = 'chrome-extension://dynamic',
      data: unknown = { type: 'viewer-hello' },
    ) => {
      const event = new Event('message');
      Object.assign(event, { source, origin, data });
      fake.dispatchEvent(event);
    };
    return { frame, connect, remove, hello };
  }
  it('ignores another source', () => {
    const { hello, connect } = setup();
    hello({});
    expect(connect).not.toHaveBeenCalled();
  });
  it('ignores a hello from a web page origin, such as a frame that a script navigated', () => {
    const { hello, connect, frame } = setup();
    hello(frame.contentWindow, 'https://evil.example');
    expect(connect).not.toHaveBeenCalled();
  });
  it('replies only to the extension origin and removes the listener', () => {
    const { hello, connect, frame, remove } = setup();
    hello(frame.contentWindow);
    expect(connect).toHaveBeenCalledExactlyOnceWith('chrome-extension://dynamic');
    remove();
    hello(frame.contentWindow);
    expect(connect).toHaveBeenCalledTimes(1);
  });
});
