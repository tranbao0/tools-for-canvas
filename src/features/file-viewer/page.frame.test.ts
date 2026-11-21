// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { PaneHost } from '@/features/file-viewer/ui/ViewerApp';
import { installFakePermissions } from '@/shared/platform/testing/fakes';
import { canvasOriginItem } from '@/shared/platform/storage';
import viewerFrame from '@/entrypoints/viewer-frame';

const mount = vi.hoisted(() => vi.fn((_props: { host: PaneHost }) => null));
vi.mock('@/features/file-viewer/ui/ViewerApp', () => ({ ViewerApp: mount }));

it('requires an affirmative permission reply and requests a host pattern without a port', async () => {
  await canvasOriginItem.setValue('https://canvas.school.edu:8443');
  const request = installFakePermissions().request;
  vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValue(undefined);
  document.body.innerHTML = '<div id="app"></div>';
  viewerFrame.main();
  await vi.waitFor(() => expect(mount).toHaveBeenCalled());
  const { host } = mount.mock.calls[0]![0];
  await expect(host.hasAccess()).resolves.toBe(false);
  await host.requestAccess();
  expect(request).toHaveBeenCalledWith({
    origins: ['https://canvas.school.edu/*', 'https://*/*'],
  });
});
