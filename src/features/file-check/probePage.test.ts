import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { canvasOriginItem } from '../../shared/platform/storage';
import { startFileProbe } from './probePage';

const SAVED = 'https://school.instructure.com';
const NONCE = '00000000-0000-4000-8000-000000000000';

function fakeWindow(search: string, framed: boolean) {
  const parent = { postMessage: vi.fn() };
  const win = { location: { search }, postMessage: vi.fn() } as unknown as Window & {
    postMessage: ReturnType<typeof vi.fn>;
  };
  (win as unknown as { parent: unknown }).parent = framed ? parent : win;
  return { win, parent };
}

beforeEach(() => fakeBrowser.reset());

describe('startFileProbe', () => {
  it('posts the nonce to the saved Canvas origin only', async () => {
    await canvasOriginItem.setValue(SAVED);
    const { win, parent } = fakeWindow(`?n=${NONCE}`, true);
    await startFileProbe(win);
    expect(parent.postMessage).toHaveBeenCalledWith(
      { type: 'weekrow:file-probe', nonce: NONCE },
      SAVED,
    );
  });

  it('posts nothing when no Canvas is saved', async () => {
    const { win, parent } = fakeWindow(`?n=${NONCE}`, true);
    await startFileProbe(win);
    expect(parent.postMessage).not.toHaveBeenCalled();
  });

  it('posts nothing for a nonce that is missing or odd', async () => {
    await canvasOriginItem.setValue(SAVED);
    for (const search of ['', '?n=', '?n=<script>', '?n=abc', `?n=${'a'.repeat(100)}`]) {
      const { win, parent } = fakeWindow(search, true);
      await startFileProbe(win);
      expect(parent.postMessage).not.toHaveBeenCalled();
    }
  });

  it('posts nothing when the page is not in a frame', async () => {
    await canvasOriginItem.setValue(SAVED);
    const { win } = fakeWindow(`?n=${NONCE}`, false);
    await startFileProbe(win);
    expect(win.postMessage).not.toHaveBeenCalled();
  });
});
