import { afterEach, expect, it, vi } from 'vitest';
import { watchPaneIdentity } from './paneIdentity';

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: { runtime: { sendMessage: send } } }));
afterEach(() => {
  vi.useRealTimers();
  send.mockReset();
});

it.each([false, undefined, new Error('Sign-in check failed')])(
  'removes content when its owner check returns %s',
  async (answer) => {
    vi.useFakeTimers();
    send.mockResolvedValueOnce({ token: '3:u1' }).mockResolvedValueOnce(true);
    const lost = vi.fn();
    const stop = watchPaneIdentity(lost);
    await vi.advanceTimersByTimeAsync(0);
    expect(lost).not.toHaveBeenCalled();
    if (answer instanceof Error) send.mockRejectedValueOnce(answer);
    else send.mockResolvedValueOnce(answer);
    await vi.advanceTimersByTimeAsync(1000);
    expect(send).toHaveBeenLastCalledWith({ type: 'viewer:fetch-allowed', token: '3:u1' });
    expect(lost).toHaveBeenCalledOnce();
    stop();
  },
);

it('ends its checks when the pane closes during a pending read', async () => {
  vi.useFakeTimers();
  let resolve!: (reply: unknown) => void;
  send.mockReturnValue(new Promise((done) => (resolve = done)));
  const lost = vi.fn();
  const stop = watchPaneIdentity(lost);
  stop();
  resolve({ token: '3:u1' });
  await vi.advanceTimersByTimeAsync(5000);
  expect(send).toHaveBeenCalledOnce();
  expect(lost).not.toHaveBeenCalled();
});
