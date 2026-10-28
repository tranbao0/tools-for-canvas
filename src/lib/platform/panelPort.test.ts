import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { panelPortName } from './messages';
import { HEARTBEAT_INTERVAL_MS, connectPanelPort } from './panelPort';
import { closeRemote, fakePort, type FakePort } from './testing/fakes';

const HEARTBEAT = 'heartbeat';

let ports: FakePort[];
let connect: ReturnType<typeof vi.fn>;

function lastPort(): FakePort {
  const port = ports.at(-1);
  if (port === undefined) throw new Error('no port');
  return port;
}

beforeEach(() => {
  vi.useFakeTimers();
  fakeBrowser.reset();
  ports = [];
  connect = vi.fn((info: { name: string }) => {
    const port = fakePort(info.name);
    ports.push(port);
    return port;
  });
  Object.assign(fakeBrowser.runtime, { connect });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('connectPanelPort', () => {
  it('connects at once on a port named for the window', () => {
    connectPanelPort(7);

    expect(connect).toHaveBeenCalledWith({ name: panelPortName(7) });
    expect(lastPort().postMessage).not.toHaveBeenCalled();
  });

  it('sends a heartbeat every 20 seconds', () => {
    connectPanelPort(7);
    const port = lastPort();

    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS - 1);
    expect(port.postMessage).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(port.postMessage).toHaveBeenLastCalledWith(HEARTBEAT);
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 2);
    expect(port.postMessage.mock.calls).toEqual([[HEARTBEAT], [HEARTBEAT], [HEARTBEAT]]);
  });

  it('reconnects at once when the background drops the port', () => {
    connectPanelPort(7);
    closeRemote(lastPort());

    expect(ports).toHaveLength(2);
    expect(connect).toHaveBeenLastCalledWith({ name: panelPortName(7) });

    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    expect(lastPort().postMessage).toHaveBeenLastCalledWith(HEARTBEAT);
    expect(ports[0]?.postMessage).not.toHaveBeenCalled();
  });

  it('reconnects at once again in the next heartbeat period', () => {
    connectPanelPort(7);
    closeRemote(lastPort());
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    closeRemote(lastPort());

    expect(ports).toHaveLength(3);
  });

  it('waits for the next heartbeat when the port drops again in the same period', () => {
    connectPanelPort(7);
    closeRemote(lastPort());
    closeRemote(lastPort());
    expect(ports).toHaveLength(2);

    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    expect(ports).toHaveLength(3);
  });

  it('retries on the next heartbeat when connecting throws', () => {
    connect.mockImplementationOnce(() => {
      throw new Error('Extension context invalidated.');
    });
    connectPanelPort(7);
    expect(ports).toHaveLength(0);

    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    expect(ports).toHaveLength(1);
  });

  it('reconnects when a heartbeat cannot be posted', () => {
    connectPanelPort(7);
    lastPort().postMessage.mockImplementationOnce(() => {
      throw new Error('Attempting to use a disconnected port object');
    });

    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    expect(ports).toHaveLength(2);
  });

  it('ignores a late disconnect of a port it already replaced', () => {
    connectPanelPort(7);
    const first = lastPort();
    closeRemote(first);
    closeRemote(first);

    expect(ports).toHaveLength(2);
  });
});
