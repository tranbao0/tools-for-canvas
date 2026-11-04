// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { watchSlotMode } from './slotMode';

it('reports the slot mode now and after each change of data-panel', async () => {
  const host = document.createElement('div');
  const seen = vi.fn();
  const stop = watchSlotMode(host, seen);
  expect(seen).toHaveBeenLastCalledWith(false);
  host.setAttribute('data-panel', 'slot');
  await Promise.resolve();
  expect(seen).toHaveBeenLastCalledWith(true);
  host.setAttribute('data-panel', 'stack');
  await Promise.resolve();
  expect(seen).toHaveBeenLastCalledWith(false);
  stop();
  host.setAttribute('data-panel', 'slot');
  await Promise.resolve();
  expect(seen).toHaveBeenLastCalledWith(false);
});
