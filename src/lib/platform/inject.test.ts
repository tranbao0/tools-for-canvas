import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { isCanvasDocument } from './detectCanvas';
import {
  DETECTOR_FILE,
  INPAGE_FILE,
  anyAutoSavedCanvasTab,
  injectDetectorIntoOpenTabs,
  injectInpage,
  injectInpageIntoOrigin,
} from './inject';
import { installFakeScripting, type FakeScripting } from './testing/fakes';

let scripting: FakeScripting;
let query: ReturnType<typeof vi.fn<() => Promise<unknown[]>>>;
/** The page that `tabs.get` finds in each tab, by id. */
let tabUrls: Map<number, string>;

function tab(id: number | undefined, url: string, discarded = false) {
  return { id, url, discarded };
}

beforeEach(() => {
  fakeBrowser.reset();
  scripting = installFakeScripting();
  query = vi.fn<() => Promise<unknown[]>>(async () => []);
  tabUrls = new Map([[7, 'https://canvas.school.edu/courses/5']]);
  const get = vi.fn(async (id: number) => {
    const pages = (await query()) as { id?: number; url?: string }[];
    return { id, url: tabUrls.get(id) ?? pages.find((page) => page.id === id)?.url };
  });
  Object.assign(fakeBrowser.tabs, { query, get });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('the built files', () => {
  it('are the paths WXT gives the detector and the in-page script', () => {
    expect(DETECTOR_FILE).toBe('/detector.js');
    expect(INPAGE_FILE).toBe('/inpage.js');
  });
});

describe('injectInpage', () => {
  const ORIGIN = 'https://canvas.school.edu';

  it('runs the in-page script in the top frame of the tab', async () => {
    await injectInpage(7, ORIGIN);

    expect(scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 7, frameIds: [0] },
      files: [INPAGE_FILE],
    });
  });

  it('targets the document that sent the report, so a tab that moved on gets nothing', async () => {
    await injectInpage(7, ORIGIN, 'doc-1');

    expect(scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 7, documentIds: ['doc-1'] },
      files: [INPAGE_FILE],
    });
  });

  it('reads the tab URL first, and injects nothing when the tab shows another origin', async () => {
    tabUrls.set(7, 'https://evil.example/');
    await expect(injectInpage(7, ORIGIN)).rejects.toThrow('no longer shows');
    await expect(injectInpage(7, ORIGIN, 'doc-1')).rejects.toThrow('no longer shows');

    tabUrls.set(7, 'https://canvas.school.edu:8443/');
    await expect(injectInpage(7, ORIGIN)).rejects.toThrow('no longer shows');

    tabUrls.delete(7);
    await expect(injectInpage(7, ORIGIN)).rejects.toThrow('no longer shows');
    expect(scripting.executeScript).not.toHaveBeenCalled();
  });

  it('rejects when the browser refuses', async () => {
    scripting.executeScript.mockRejectedValueOnce(new Error('Cannot access'));
    await expect(injectInpage(7, ORIGIN)).rejects.toThrow('Cannot access');
  });
});

describe('injectInpageIntoOrigin', () => {
  it('runs the in-page script in the open tabs of exactly that origin', async () => {
    query.mockResolvedValue([
      tab(1, 'https://canvas.school.edu/courses/5'),
      tab(2, 'https://canvas.school.edu:8443/courses/5'),
      tab(3, 'https://canvas.school.edu/'),
      tab(4, 'https://canvas.school.edu/', true),
      tab(undefined, 'https://canvas.school.edu/'),
    ]);

    expect(await injectInpageIntoOrigin('https://canvas.school.edu')).toEqual([1, 3]);

    expect(query).toHaveBeenCalledWith({ url: 'https://canvas.school.edu/*' });
    expect(scripting.executeScript.mock.calls.map(([details]) => details.target.tabId)).toEqual([
      1, 3,
    ]);
  });

  it('skips a tab that refuses and keeps going', async () => {
    query.mockResolvedValue([
      tab(1, 'https://canvas.school.edu/'),
      tab(2, 'https://canvas.school.edu/'),
    ]);
    scripting.executeScript.mockRejectedValueOnce(new Error('Cannot access'));

    expect(await injectInpageIntoOrigin('https://canvas.school.edu')).toEqual([2]);
  });

  it('asks about nothing for text that is not an origin', async () => {
    expect(await injectInpageIntoOrigin('nope')).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('injectDetectorIntoOpenTabs', () => {
  it('runs the detector in every open https tab, which the host permission lets it list', async () => {
    query.mockResolvedValue([
      tab(1, 'https://canvas.school.edu/'),
      tab(2, 'https://news.example.com/'),
      tab(3, 'https://discarded.example.com/', true),
    ]);

    expect(await injectDetectorIntoOpenTabs()).toEqual([
      { id: 1, url: 'https://canvas.school.edu/' },
      { id: 2, url: 'https://news.example.com/' },
    ]);

    expect(query).toHaveBeenCalledWith({ url: 'https://*/*' });
    expect(scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 1 },
      files: [DETECTOR_FILE],
    });
    expect(scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 2 },
      files: [DETECTOR_FILE],
    });
    expect(scripting.executeScript).toHaveBeenCalledTimes(2);
  });

  it('ignores tabs that fail, such as a browser store page', async () => {
    query.mockResolvedValue([
      tab(1, 'https://chromewebstore.google.com/'),
      tab(2, 'https://a.edu/'),
    ]);
    scripting.executeScript.mockRejectedValueOnce(
      new Error('The extensions gallery cannot be scripted'),
    );

    expect(await injectDetectorIntoOpenTabs()).toEqual([{ id: 2, url: 'https://a.edu/' }]);
    expect(console.warn).toHaveBeenCalledWith(
      '[weekrow] detector injection failed',
      expect.any(Error),
    );
  });
});

describe('anyAutoSavedCanvasTab', () => {
  const SCHOOL = 'https://school.instructure.com/';
  const CUSTOM = 'https://canvas.school.edu/';

  it('checks each tab on an instructure.com host, and is true when one of them is Canvas', async () => {
    scripting.executeScript.mockImplementation(async ({ target }) => [
      { frameId: 0, documentId: 'd', result: target.tabId === 2 },
    ]);
    const tabs = [
      { id: 1, url: 'https://a.instructure.com/' },
      { id: 2, url: SCHOOL },
      { id: 3, url: 'https://b.instructure.com/' },
    ];

    expect(await anyAutoSavedCanvasTab(tabs)).toBe(true);
    expect(scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 1 },
      func: isCanvasDocument,
    });
  });

  it('is false for a Canvas on its own domain, because the student answers its offer', async () => {
    scripting.executeScript.mockResolvedValue([{ frameId: 0, documentId: 'd', result: true }]);

    expect(await anyAutoSavedCanvasTab([{ id: 1, url: CUSTOM }])).toBe(false);
    expect(await anyAutoSavedCanvasTab([{ id: 1, url: 'https://s.beta.instructure.com/' }])).toBe(
      false,
    );
    expect(scripting.executeScript).not.toHaveBeenCalled();
  });

  it('is false when no tab is Canvas, when a tab refuses, with no URL, and for no tabs', async () => {
    scripting.executeScript.mockResolvedValueOnce([{ frameId: 0, documentId: 'd', result: false }]);
    scripting.executeScript.mockRejectedValueOnce(new Error('Cannot access'));
    expect(
      await anyAutoSavedCanvasTab([
        { id: 1, url: SCHOOL },
        { id: 2, url: 'https://b.instructure.com/' },
        { id: 3, url: undefined },
      ]),
    ).toBe(false);
    expect(await anyAutoSavedCanvasTab([])).toBe(false);
  });
});
