import { afterEach, beforeEach, expect, it, vi } from 'vitest';
beforeEach(() => vi.stubEnv('BROWSER', 'firefox'));
afterEach(() => vi.unstubAllEnvs());
import { routeViewerMessage, type ViewerHost } from './background';

const pane = { url: 'moz-extension://test/viewer.html', frameId: 3, tab: { id: 7 } };
function setup() {
  const savedOrigin = vi.fn(async () => 'https://school.edu');
  const host = {
    savedOrigin,
    tabUrl: vi.fn(async () => 'https://school.edu/courses/1'),
    isExtensionPage: (sender: { url?: string }) =>
      sender.url?.startsWith('moz-extension://test/') === true,
  } as unknown as ViewerHost;
  return { host, savedOrigin };
}
it('gives the pane only the saved Canvas origin', async () => {
  const { host } = setup();
  expect(await routeViewerMessage({ type: 'viewer:origin' }, pane, host)).toEqual({
    canvasOrigin: 'https://school.edu',
  });
});
it.each([
  { ...pane, url: 'https://school.edu/courses/1', frameId: 0 },
  { ...pane, url: 'https://school.edu/courses/1', frameId: 3 },
  { ...pane, frameId: 0 },
  { ...pane, tab: undefined },
  { ...pane, url: 'moz-extension://test/options.html' },
])('refuses a caller outside the pane before reading storage: %j', async (sender) => {
  const { host, savedOrigin } = setup();
  await expect(routeViewerMessage({ type: 'viewer:origin' }, sender, host)).rejects.toThrow();
  expect(savedOrigin).not.toHaveBeenCalled();
});
it.each([{ key: 'sessionFingerprintSalt' }, { operation: 'keys' }, { value: 'changed' }])(
  'refuses extra request fields: %j',
  async (extra) => {
    const { host, savedOrigin } = setup();
    await expect(
      routeViewerMessage({ type: 'viewer:origin', ...extra }, pane, host),
    ).rejects.toThrow();
    expect(savedOrigin).not.toHaveBeenCalled();
  },
);

it.each([null, 'https://other.edu/', 'https://school.edu.evil.example/'])(
  'refuses the pane origin read when the top page is %s',
  async (url) => {
    const { host } = setup();
    vi.mocked(host.tabUrl).mockResolvedValue(url);
    await expect(routeViewerMessage({ type: 'viewer:origin' }, pane, host)).rejects.toThrow();
  },
);
