// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { connectPanelPort, getCurrent, browserMock } = vi.hoisted(() => {
  const getCurrent = vi.fn(async () => ({ id: 7 }));
  return {
    connectPanelPort: vi.fn(),
    getCurrent,
    browserMock: { windows: { getCurrent } as { getCurrent: typeof getCurrent } | undefined },
  };
});

vi.mock('wxt/browser', () => ({ browser: browserMock }));
vi.mock('../../../shared/platform/panelPort', () => ({ connectPanelPort }));
vi.mock('../../../shared/ui/styles', () => ({ installStyles: vi.fn() }));
vi.mock('../../../shared/ui/theme', () => ({ followExtensionPageTheme: vi.fn() }));
vi.mock('../data/storage', () => ({ settingsItem: {} }));
vi.mock('./hosts', () => ({ extensionPageHost: vi.fn(), mountRuntime: vi.fn() }));
vi.mock('./runtime', () => ({ createSurfaceRuntime: vi.fn(() => ({ actions: {} })) }));
vi.mock('../ui/App', () => ({ App: () => null }));

import { startPanel } from './panelPage';

describe('the side panel page', () => {
  beforeEach(() => {
    connectPanelPort.mockReset();
    getCurrent.mockClear();
    browserMock.windows = { getCurrent };
  });

  it('connects the port with the id of its window', async () => {
    startPanel(document.createElement('div'));
    await vi.waitFor(() => expect(connectPanelPort).toHaveBeenCalledWith(7));
  });

  it('starts without a windows API, as on Firefox for Android', () => {
    browserMock.windows = undefined;
    expect(() => startPanel(document.createElement('div'))).not.toThrow();
    expect(connectPanelPort).not.toHaveBeenCalled();
  });
});
