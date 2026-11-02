import { toolsSettingsItem } from '../settings/toolsItem';
import { DEFAULT_TOOLS_SETTINGS } from '../settings/tools';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { isCanvasDocument } from './detectCanvas';
import {
  DASHBOARD_FILE,
  DETECTOR_FILE,
  FRAME_FILE,
  INPAGE_FILE,
  anyAutoSavedCanvasTab,
  injectDetectorIntoOpenTabs,
  injectInpage,
  injectInpageIntoOrigin,
  injectSubmissionFrames,
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
    expect(DASHBOARD_FILE).toBe('/dashboard.js');
  });
});

describe('injectInpage', () => {
  it('leaves the viewer script out when its switch is off', async () => {
    await toolsSettingsItem.setValue({ ...DEFAULT_TOOLS_SETTINGS, fileViewer: false });
    await injectInpage(7, 'https://canvas.school.edu');
    expect(scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 7, frameIds: [0] },
      files: [INPAGE_FILE],
    });
  });
  const ORIGIN = 'https://canvas.school.edu';

  it('runs the in-page script in the top frame of the tab', async () => {
    await injectInpage(7, ORIGIN);

    expect(scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 7, frameIds: [0] },
      files: [INPAGE_FILE, '/viewer.js'],
    });
  });

  it.each(['/', '/dashboard', '/dashboard/'])(
    'adds the dashboard fixes script on the dashboard path %s',
    async (path) => {
      tabUrls.set(7, `${ORIGIN}${path}?x=1`);

      await injectInpage(7, ORIGIN);

      expect(scripting.executeScript).toHaveBeenCalledWith({
        target: { tabId: 7, frameIds: [0] },
        files: [INPAGE_FILE, DASHBOARD_FILE, '/viewer.js'],
      });
    },
  );

  it.each(['/courses/5', '/courses/5/assignments', '/calendar', '/dashboards'])(
    'adds no dashboard fixes script on %s',
    async (path) => {
      tabUrls.set(7, `${ORIGIN}${path}`);

      await injectInpage(7, ORIGIN);

      expect(scripting.executeScript).toHaveBeenCalledWith({
        target: { tabId: 7, frameIds: [0] },
        files: [INPAGE_FILE, '/viewer.js'],
      });
    },
  );

  it('targets the document that sent the report, so a tab that moved on gets nothing', async () => {
    await injectInpage(7, ORIGIN, 'doc-1');

    expect(scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 7, documentIds: ['doc-1'] },
      files: [INPAGE_FILE, '/viewer.js'],
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

describe('injectSubmissionFrames', () => {
  const ORIGIN = 'https://canvas.school.edu';
  const SUBMISSION = `${ORIGIN}/courses/5/assignments/3/submissions/9`;
  /** The answers of the probe, one for each frame of the tab. */
  const probes = (...frames: { frameId: number; origin: string; path: string }[]) =>
    frames.map(({ frameId, origin, path }) => ({ frameId, result: { origin, path } }));
  const PATH = '/courses/5/assignments/3/submissions/9';

  beforeEach(() => {
    tabUrls.set(7, SUBMISSION);
  });

  it('puts the catcher into the same-origin child frames of a submission page, and no other frame', async () => {
    scripting.executeScript.mockResolvedValueOnce(
      probes(
        { frameId: 0, origin: ORIGIN, path: PATH },
        { frameId: 4, origin: ORIGIN, path: PATH },
        { frameId: 5, origin: 'https://video.example', path: PATH },
        { frameId: 6, origin: ORIGIN, path: '/courses/5/files/9' },
        { frameId: 8, origin: ORIGIN, path: PATH },
      ) as never,
    );
    await injectSubmissionFrames(7, ORIGIN);
    expect(scripting.executeScript).toHaveBeenCalledTimes(2);
    expect(scripting.executeScript.mock.calls[0]![0]).toMatchObject({
      target: { tabId: 7, allFrames: true },
    });
    expect(scripting.executeScript).toHaveBeenLastCalledWith({
      target: { tabId: 7, frameIds: [4, 8] },
      files: [FRAME_FILE],
    });
  });

  it('names the probed documents when the browser has document ids', async () => {
    scripting.executeScript.mockResolvedValueOnce([
      { frameId: 0, documentId: 'top', result: { origin: ORIGIN, path: PATH } },
      { frameId: 4, documentId: 'doc-4', result: { origin: ORIGIN, path: PATH } },
      { frameId: 5, documentId: 'doc-5', result: { origin: 'null', path: PATH } },
    ] as never);
    await injectSubmissionFrames(7, ORIGIN);
    expect(scripting.executeScript).toHaveBeenLastCalledWith({
      target: { tabId: 7, documentIds: ['doc-4'] },
      files: [FRAME_FILE],
    });
  });

  it('runs a probe that only reads the origin and the path of a frame', async () => {
    scripting.executeScript.mockResolvedValueOnce([] as never);
    await injectSubmissionFrames(7, ORIGIN);
    const probe = (scripting.executeScript.mock.calls[0]![0] as unknown as { func: () => unknown })
      .func;
    vi.stubGlobal('self', { origin: ORIGIN });
    vi.stubGlobal('location', { origin: ORIGIN, pathname: PATH, search: '?secret=1' });
    try {
      expect(probe()).toEqual({ origin: ORIGIN, path: PATH });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('injects nothing when no frame qualifies', async () => {
    scripting.executeScript.mockResolvedValueOnce(
      probes({ frameId: 0, origin: ORIGIN, path: PATH }) as never,
    );
    await injectSubmissionFrames(7, ORIGIN);
    expect(scripting.executeScript).toHaveBeenCalledTimes(1);
  });

  it('refuses a tab that no longer shows a submission page of the origin', async () => {
    for (const url of [
      `${ORIGIN}/courses/5`,
      'https://other.school.edu/courses/5/assignments/3/submissions/9',
    ]) {
      tabUrls.set(7, url);
      await expect(injectSubmissionFrames(7, ORIGIN)).rejects.toThrow('submission page');
    }
    expect(scripting.executeScript).not.toHaveBeenCalled();
  });

  it('does nothing when the file viewer is off', async () => {
    await toolsSettingsItem.setValue({ ...DEFAULT_TOOLS_SETTINGS, fileViewer: false });
    await injectSubmissionFrames(7, ORIGIN);
    expect(scripting.executeScript).not.toHaveBeenCalled();
  });
});
