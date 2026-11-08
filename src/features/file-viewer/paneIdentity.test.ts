import { afterEach, expect, it, vi } from 'vitest';
import { checkPaneIdentity, watchPaneIdentity } from './paneIdentity';

const { send, reset } = vi.hoisted(() => ({ send: vi.fn(), reset: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: { runtime: { sendMessage: send } } }));
vi.mock('./paneReset', () => ({ resetPanes: reset }));
const stops: (() => void)[] = [];
afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  vi.useRealTimers();
  send.mockReset();
  reset.mockReset();
});

it.each([undefined, { verdict: 'unknown' }, new Error('Context gone')])(
  'covers without resetting on %s',
  async (answer) => {
    vi.useFakeTimers();
    send.mockResolvedValue({ verdict: 'yes', token: '3:42' });
    const show = vi.fn();
    stops.push(watchPaneIdentity(show));
    await vi.advanceTimersByTimeAsync(0);
    expect(show).toHaveBeenLastCalledWith(true);
    if (answer instanceof Error) send.mockRejectedValue(answer);
    else send.mockResolvedValue(answer);
    await vi.advanceTimersByTimeAsync(1000);
    expect(show).toHaveBeenLastCalledWith(false);
    expect(reset).not.toHaveBeenCalled();
    send.mockResolvedValue({ verdict: 'yes', token: '3:42' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(show).toHaveBeenLastCalledWith(true);
  },
);

it('keeps ticking when replies never arrive and covers at five seconds', async () => {
  vi.useFakeTimers();
  send.mockResolvedValue({ verdict: 'yes', token: '3:42' });
  const show = vi.fn();
  stops.push(watchPaneIdentity(show));
  await vi.advanceTimersByTimeAsync(0);
  send.mockReturnValue(new Promise(() => undefined));
  await vi.advanceTimersByTimeAsync(6000);
  expect(send).toHaveBeenCalledTimes(7);
  expect(show).toHaveBeenLastCalledWith(false);
  expect(reset).not.toHaveBeenCalled();
});

it('shares one timer across docks and stops after the last closes', async () => {
  vi.useFakeTimers();
  send.mockResolvedValue({ verdict: 'yes', token: '3:42' });
  const first = watchPaneIdentity(vi.fn());
  const second = watchPaneIdentity(vi.fn());
  stops.push(first, second);
  await vi.advanceTimersByTimeAsync(0);
  send.mockClear();
  await vi.advanceTimersByTimeAsync(3000);
  expect(send).toHaveBeenCalledTimes(3);
  first();
  await vi.advanceTimersByTimeAsync(1000);
  expect(send).toHaveBeenCalledTimes(4);
  second();
  await vi.advanceTimersByTimeAsync(10000);
  expect(send).toHaveBeenCalledTimes(4);
});

it('uses the content token and fires the full reset on no', async () => {
  vi.useFakeTimers();
  send.mockResolvedValue({ verdict: 'no' });
  stops.push(watchPaneIdentity(vi.fn(), '1:42'));
  await vi.advanceTimersByTimeAsync(0);
  expect(send).toHaveBeenCalledWith({ type: 'viewer:pane-check', token: '1:42' });
  expect(reset).toHaveBeenCalledOnce();
});

it('ignores a late yes from a closed registration', async () => {
  vi.useFakeTimers();
  let resolve!: (reply: unknown) => void;
  send.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const show = vi.fn();
  const stop = watchPaneIdentity(show);
  stop();
  resolve({ verdict: 'yes', token: '3:42' });
  await vi.advanceTimersByTimeAsync(0);
  expect(show).toHaveBeenCalledTimes(1);
  expect(show).toHaveBeenLastCalledWith(false);
});

it('a one-shot token read times out as unknown', async () => {
  vi.useFakeTimers();
  send.mockReturnValue(new Promise(() => undefined));
  const read = checkPaneIdentity();
  await vi.advanceTimersByTimeAsync(5000);
  await expect(read).resolves.toEqual({ verdict: 'unknown' });
});

it('a late tick with no unanswered request does not cover a healthy pane', async () => {
  vi.useFakeTimers();
  send.mockResolvedValue({ verdict: 'yes', token: '3:42' });
  const show = vi.fn();
  stops.push(watchPaneIdentity(show));
  await vi.advanceTimersByTimeAsync(0);
  show.mockClear();
  vi.setSystemTime(Date.now() + 60000);
  await vi.advanceTimersByTimeAsync(1000);
  expect(show.mock.calls).toEqual([[true]]);
});
