import { browser } from 'wxt/browser';
import { h, render } from 'preact';
import { canvasOriginItem } from '@/shared/platform/storage';
import {
  acceptViewerConnect,
  bindViewerPort,
  helloMessage,
  isViewerSecret,
} from '@/features/file-viewer/channel';
import { isCommentTab, normalizeTabs } from '@/features/file-viewer/model';
import { loadCommentFile } from '@/features/file-viewer/ui/commentFile';
import { createCoveredStore } from '@/features/file-viewer/ui/covered';
import { createFullViewStore } from '@/features/file-viewer/ui/fullView';
import { createOpenSource } from '@/features/file-viewer/ui/openSource';
import { ViewerApp, type PaneHost } from '@/features/file-viewer/ui/ViewerApp';
import type { PaneFile } from '@/features/file-viewer/ui/FileCard';
import { readPaneBytes, type ByteSource } from '@/features/file-viewer/bytes';
import { readAddress } from '@/features/file-viewer/ui/links';
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
  // Firefox embeds this frame in the page process. It has no access to the full vault.
  const origin =
    import.meta.env.BROWSER === 'firefox'
      ? browser.runtime.sendMessage({ type: 'viewer:origin' }).then((reply: unknown) => {
          if (typeof reply !== 'object' || reply === null || !('canvasOrigin' in reply))
            return null;
          return typeof reply.canvasOrigin === 'string' ? reply.canvasOrigin : null;
        })
      : canvasOriginItem.getValue();
  const style = document.createElement('style');
  style.textContent = `${APP_CSS}\n${viewerCss}\n${pdfCss}`;
  document.head.append(style);
  const opens = createOpenSource();
  let port: MessagePort | undefined;
  const fullView = createFullViewStore((on) => port?.postMessage({ type: 'full-view', on }));
  const covered = createCoveredStore();
  // The token that the last read of the tabs gave. A write carries it back.
  let tabsToken: string | undefined;

  // The background says whether the cookie is confirmed for the student of the cache. Every read
  // of file bytes asks it.
  const confirmCookie = async () =>
    (await browser.runtime.sendMessage({ type: 'viewer:fetch-allowed', token: tabsToken })) ===
    true;

  // What the background reads when the pane read of an address fails for a missing cookie. It
  // reads the file of the id or the comment attachment, never an address of the pane.
  const sources = new Map<string, ByteSource>();

  const host = (canvasOrigin: string): PaneHost => ({
    origin: canvasOrigin,
    async loadFile(fileId, name) {
      if (isCommentTab(fileId)) {
        const comment = await loadCommentFile({
          tabId: fileId,
          name,
          origin: canvasOrigin,
          // Nothing has confirmed the cookie for this file yet, so the background may check it
          // once before the read. The read itself uses the strict check.
          prepare: async () =>
            (await browser.runtime.sendMessage({ type: 'viewer:confirm-cookie' })) === true,
          confirm: confirmCookie,
        });
        sources.set(comment.url, { commentTab: fileId });
        return comment;
      }
      const file: unknown = await browser.runtime.sendMessage({ type: 'viewer:file', fileId });
      if (!isPaneFile(file)) return undefined;
      // The tab reads this address, which the background builds the same way.
      const address = readAddress(canvasOrigin, fileId, file.url);
      if (address !== null) sources.set(address, { fileId });
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
    readFile: (url, onProgress, signal, options) =>
      readPaneBytes(
        {
          origin: canvasOrigin,
          url,
          onProgress,
          signal,
          ...(options?.truncateAt === undefined ? {} : { truncateAt: options.truncateAt }),
          confirm: confirmCookie,
        },
        sources.get(url),
      ),
    loadPdfjs,
    async hasAccess() {
      return (await browser.runtime.sendMessage({ type: 'viewer:permission' })) !== false;
    },
    requestAccess: () => browser.permissions.request({ origins: accessOrigins(canvasOrigin) }),
    async getTabs() {
      const reply: unknown = await browser.runtime.sendMessage({ type: 'viewer:tabs-get' });
      // A reply that is not an object is a refusal or an error. It is not "no tabs".
      if (typeof reply !== 'object' || reply === null) throw new Error('The tabs did not load');
      const token = (reply as { token?: unknown }).token;
      tabsToken = typeof token === 'string' ? token : undefined;
      return normalizeTabs(reply);
    },
    tabToken: () => tabsToken,
    async changeTabs(intent, token) {
      const { action, ...data } = intent;
      const reply = await browser.runtime.sendMessage({
        type: 'viewer:tabs-' + action,
        ...data,
        token,
      });
      if (!reply || typeof reply !== 'object') throw new Error('The tabs did not save');
      return normalizeTabs(reply);
    },
    closePane: () => port?.postMessage({ type: 'close' }),
    fullView,
    covered,
  });

  // The secret of this pane, from the background. It is in no address and in no window message.
  const secret: Promise<string | undefined> = (
    browser.runtime.sendMessage({ type: 'viewer:session' }) as Promise<{ secret?: unknown }>
  ).then(
    (reply) => (isViewerSecret(reply?.secret) ? reply.secret : undefined),
    () => undefined,
  );
  // The pane keeps listening until a port proves the secret. A script of the Canvas page can send
  // a port too, and it must not block the port of the page script.
  const listener = async (event: MessageEvent) => {
    const [canvasOrigin, known] = await Promise.all([origin, secret]);
    if (!canvasOrigin || !known) return;
    const offered = acceptViewerConnect(event, canvasOrigin, parent);
    if (!offered) return;
    bindViewerPort(offered, known, {
      receive(message) {
        if (message.type === 'theme') {
          document.documentElement.setAttribute('data-theme', message.theme);
          return;
        }
        if (message.type === 'covered') {
          covered.receive(message.covered);
          return;
        }
        if (message.type === 'full-view') {
          fullView.receive({ on: message.on, available: message.available });
          return;
        }
        opens.emit({
          fileId: message.fileId,
          token: message.token,
          ...(message.courseId ? { courseId: message.courseId } : {}),
          ...(message.name ? { name: message.name } : {}),
          ...(message.address ? { address: message.address } : {}),
        });
      },
      bound() {
        if (port) return;
        port = offered;
        window.removeEventListener('message', listener);
        document.addEventListener('keydown', (key) => {
          if (key.key === 'Escape') port?.postMessage({ type: 'escape' });
        });
      },
    });
  };
  window.addEventListener('message', listener);
  void origin.then((canvasOrigin) => {
    if (!canvasOrigin) return;
    render(h(ViewerApp, { host: host(canvasOrigin), opens }), document.getElementById('app')!);
    // Tell the Canvas page that this frame is ready, at the saved Canvas origin only.
    void secret.then((known) => {
      if (known) parent.postMessage(helloMessage(browser.runtime.id), canvasOrigin);
    });
  });
});
