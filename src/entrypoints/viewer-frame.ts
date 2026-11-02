import { browser } from 'wxt/browser';
import { canvasOriginItem } from '@/shared/platform/storage';
import { acceptViewerChannel } from '@/features/file-viewer/channel';

export default defineUnlistedScript(() => {
  const origin = canvasOriginItem.getValue();
  const nonce = location.hash.slice(1);
  const listener = async (event: MessageEvent) => {
    const canvasOrigin = await origin;
    if (!canvasOrigin) return;
    const disconnect = acceptViewerChannel(event, canvasOrigin, parent, nonce, (message) => {
      void browser.runtime
        .sendMessage({ type: 'viewer:file', fileId: message.fileId })
        .then((file: { name: string } | undefined) => {
          document.body.textContent = file?.name ?? 'File unavailable';
        });
    });
    if (disconnect) {
      window.removeEventListener('message', listener);
      document.addEventListener('keydown', (key) => {
        if (key.key === 'Escape') event.ports[0]?.postMessage({ type: 'close', nonce });
      });
    }
  };
  window.addEventListener('message', listener);
});
