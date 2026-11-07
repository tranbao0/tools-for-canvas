import { afterEach, expect, it, vi } from 'vitest';
import { resetPanes, watchPaneReset } from './paneReset';

const { add, remove } = vi.hoisted(() => ({ add: vi.fn(), remove: vi.fn() }));
vi.mock('wxt/browser', () => ({
  browser: {
    runtime: { id: 'extension', onMessage: { addListener: add, removeListener: remove } },
  },
}));
const stops: (() => void)[] = [];
afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  vi.clearAllMocks();
});

it('shares one checked background listener and resets every consumer', () => {
  const page = vi.fn();
  const view = vi.fn();
  stops.push(watchPaneReset(page), watchPaneReset(view));
  expect(add).toHaveBeenCalledOnce();
  const receive = add.mock.calls[0]![0];
  receive({ type: 'viewer:reset' }, { id: 'other' });
  receive({ type: 'viewer:reset' }, { id: 'extension', tab: { id: 2 } });
  expect(page).not.toHaveBeenCalled();
  receive({ type: 'viewer:reset' }, { id: 'extension' });
  expect(page).toHaveBeenCalledOnce();
  expect(view).toHaveBeenCalledOnce();
  resetPanes();
  expect(page).toHaveBeenCalledTimes(2);
  expect(view).toHaveBeenCalledTimes(2);
});

it('an expired listener does not prevent the other resets', () => {
  const view = vi.fn();
  stops.push(
    watchPaneReset(() => {
      throw new Error('Context gone');
    }),
    watchPaneReset(view),
  );
  resetPanes();
  expect(view).toHaveBeenCalledOnce();
});
