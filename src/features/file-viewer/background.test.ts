import { describe, expect, it, vi } from 'vitest';
import { createViewerOwner, routeViewerMessage, type ViewerHost } from './background';

function setup() {
  const api = {
    getViewerFile: vi.fn(async () => ({
      display_name: 'Notes',
      'content-type': 'text/plain',
      size: 10,
      url: '/files/1/download',
      context_type: 'Course',
      context_id: '2',
    })),
    getViewerModuleItem: vi.fn(async () => ({ type: 'File', content_id: '1' })),
  };
  const host: ViewerHost = {
    savedOrigin: async () => 'https://school.edu',
    isExtensionPage: (sender) => sender.url === 'extension://viewer.html',
    api: () => api,
    getTabs: vi.fn(async () => ({ ids: ['1'], active: '1' })),
    setTabs: vi.fn(async () => {}),
    permission: vi.fn(async () => true),
  };
  const sender = { url: 'https://school.edu/courses/2', frameId: 0, tab: { id: 7 } };
  return { host, sender, api };
}
describe('viewer owner', () => {
  it('maps the file record and resolves module files', async () => {
    const { host, api } = setup();
    const owner = createViewerOwner(host);
    expect(await owner.file('https://school.edu', '1')).toEqual({
      name: 'Notes',
      contentType: 'text/plain',
      size: 10,
      url: '/files/1/download',
      courseId: '2',
    });
    expect(await owner.moduleItem('https://school.edu', '2', '3', '4')).toEqual({ fileId: '1' });
    expect(api.getViewerModuleItem).toHaveBeenCalledWith('2', '3', '4');
    api.getViewerModuleItem.mockResolvedValue({ type: 'Page', content_id: '1' });
    await expect(owner.moduleItem('https://school.edu', '2', '3', '4')).rejects.toThrow(
      'not a file',
    );
  });
});
describe('viewer router', () => {
  it.each([
    'viewer:file',
    'viewer:module-item',
    'viewer:tabs-get',
    'viewer:tabs-set',
    'viewer:permission',
  ])('rejects an untrusted sender for %s', async (type) => {
    const { host, sender, api } = setup();
    await expect(
      routeViewerMessage({ type, fileId: '1' }, { ...sender, url: 'https://other.edu' }, host),
    ).rejects.toThrow('saved Canvas');
    expect(api.getViewerFile).not.toHaveBeenCalled();
  });
  it('takes the tab id from the sender and normalizes the stored value', async () => {
    const { host, sender } = setup();
    await routeViewerMessage(
      { type: 'viewer:tabs-set', tabId: 99, tabs: { ids: ['1', '../bad'], active: 'bad' } },
      sender,
      host,
    );
    expect(host.setTabs).toHaveBeenCalledWith('viewer:https://school.edu:7', {
      ids: ['1'],
      active: '1',
    });
    expect(await routeViewerMessage({ type: 'viewer:tabs-get' }, sender, host)).toEqual({
      ids: ['1'],
      active: '1',
    });
  });
  it('allows extension pages and rejects paths as ids', async () => {
    const { host, sender } = setup();
    expect(
      await routeViewerMessage(
        { type: 'viewer:permission' },
        { url: 'extension://viewer.html' },
        host,
      ),
    ).toBe(true);
    await expect(
      routeViewerMessage({ type: 'viewer:file', fileId: '/files/1' }, sender, host),
    ).rejects.toThrow('Invalid');
    await expect(
      routeViewerMessage({ type: 'viewer:tabs-get' }, { url: 'extension://viewer.html' }, host),
    ).rejects.toThrow('browser tab');
    expect(routeViewerMessage({ type: 'other' }, sender, host)).toBeNull();
  });
});
