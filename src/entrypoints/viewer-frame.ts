import { browser } from 'wxt/browser';
import { h, render } from 'preact';
import { canvasOriginItem } from '@/shared/platform/storage';
import { acceptViewerChannel } from '@/features/file-viewer/channel';
import { normalizeTabs, type Tabs } from '@/features/file-viewer/model';
import { createOpenSource } from '@/features/file-viewer/ui/openSource';
import { ViewerApp, type PaneHost } from '@/features/file-viewer/ui/ViewerApp';
import type { PaneFile } from '@/features/file-viewer/ui/FileCard';
import { fetchFileBytes } from '@/shared/canvas/fileBytes';
import { loadPdfjs } from '@/features/file-viewer/pdf/loader';
import { APP_CSS } from '@/shared/ui/styles';
import pdfCss from '@/features/file-viewer/ui/pdf.css?inline';
import viewerCss from '@/features/file-viewer/ui/viewer.css?inline';

function isPaneFile(value: unknown): value is Omit<PaneFile, 'courseId'> & { courseId?: unknown } {
  if (typeof value !== 'object' || value === null) return false;
  const file = value as Record<string, unknown>;
  return typeof file['name'] === 'string' && typeof file['contentType'] === 'string';
}

/** The host access that the files of the saved Canvas need, the same set that the background checks. */
function accessOrigins(origin: string): string[] {
  return [`${origin}/*`, 'https://*/*'];
}

export default defineUnlistedScript(() => {
  const origin = canvasOriginItem.getValue();
  const nonce = location.hash.slice(1);
  const style = document.createElement('style');
  style.textContent = `${APP_CSS}\n${viewerCss}\n${pdfCss}`;
  document.head.append(style);
  const opens = createOpenSource();
  let port: MessagePort | undefined;

  const host = (canvasOrigin: string): PaneHost => ({
    origin: canvasOrigin,
    async loadFile(fileId) {
      const file: unknown = await browser.runtime.sendMessage({ type: 'viewer:file', fileId });
      if (!isPaneFile(file)) return undefined;
      return {
        name: file.name,
        contentType: file.contentType,
        size: typeof file.size === 'number' ? file.size : Number.NaN,
        url: typeof file.url === 'string' ? file.url : '',
        courseId:
          typeof file.courseId === 'string' || typeof file.courseId === 'number'
            ? String(file.courseId)
            : null,
      };
    },
    readFile: (url, onProgress, signal) =>
      fetchFileBytes({ origin: canvasOrigin, url, onProgress, signal }),
    loadPdfjs,
    async hasAccess() {
      return (await browser.runtime.sendMessage({ type: 'viewer:permission' })) !== false;
    },
    requestAccess: () => browser.permissions.request({ origins: accessOrigins(canvasOrigin) }),
    async getTabs() {
      return normalizeTabs(await browser.runtime.sendMessage({ type: 'viewer:tabs-get' }));
    },
    async setTabs(tabs: Tabs) {
      await browser.runtime.sendMessage({ type: 'viewer:tabs-set', tabs });
    },
    closePane: () => port?.postMessage({ type: 'close', nonce }),
  });

  const listener = async (event: MessageEvent) => {
    const canvasOrigin = await origin;
    if (!canvasOrigin) return;
    const disconnect = acceptViewerChannel(event, canvasOrigin, parent, nonce, (message) => {
      if (message.type === 'theme') {
        document.documentElement.setAttribute('data-theme', message.theme);
        return;
      }
      opens.emit({
        fileId: message.fileId,
        ...(message.courseId ? { courseId: message.courseId } : {}),
      });
    });
    if (disconnect) {
      port = event.ports[0];
      window.removeEventListener('message', listener);
      document.addEventListener('keydown', (key) => {
        if (key.key === 'Escape') port?.postMessage({ type: 'close', nonce });
      });
    }
  };
  window.addEventListener('message', listener);
  void origin.then((canvasOrigin) => {
    if (!canvasOrigin) return;
    render(h(ViewerApp, { host: host(canvasOrigin), opens }), document.getElementById('app')!);
    // Tell the Canvas page that this frame is ready, at the saved Canvas origin only.
    parent.postMessage({ type: 'viewer-hello', nonce }, canvasOrigin);
  });
});
