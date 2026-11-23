import { browser } from 'wxt/browser';
import type { CanvasDetectedMessage } from '@/features/weekly-list/data/protocol';
import { isCanvasDocument } from '@/shared/platform/detectCanvas';

function waitForCanvas(): boolean | Promise<boolean> {
  let hasCanvas = isCanvasDocument();
  if (document.readyState !== 'loading') return hasCanvas;
  if (hasCanvas && document.body !== null) return true;

  return new Promise((resolve) => {
    const observer = new MutationObserver((records) => {
      hasCanvas ||= document.getElementById('application')?.classList.contains('ic-app') === true;
      if (!hasCanvas) {
        for (const record of records) {
          // The parser can add the text in a separate mutation from its script element.
          if (isCanvasScript(record.target) || Array.from(record.addedNodes).some(isCanvasScript)) {
            hasCanvas = true;
            break;
          }
        }
      }
      if (hasCanvas && document.body !== null) finish(true);
    });
    function finish(found: boolean): void {
      observer.disconnect();
      document.removeEventListener('DOMContentLoaded', onLoaded);
      resolve(found);
    }
    function onLoaded(): void {
      finish(document.body !== null && isCanvasDocument());
    }
    observer.observe(document.documentElement ?? document, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', onLoaded);
  });
}

function isCanvasScript(node: Node): boolean {
  if (!(node instanceof HTMLScriptElement) || node.hasAttribute('src')) return false;
  const text = node.textContent ?? '';
  return /(?:^|[\s;])ENV\s*=/.test(text) && /(?:^|[\s;])INST\s*=/.test(text);
}

// The manifest runs this unlisted script in the top frame of every HTTPS page.
export default defineUnlistedScript(async () => {
  if (!(await waitForCanvas())) return;
  const message: CanvasDetectedMessage = {
    type: 'weekrow:canvas-detected',
    origin: location.origin,
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, attempt * 250));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const reply: unknown = await Promise.race([
        browser.runtime.sendMessage(message),
        new Promise((resolve) => {
          timer = setTimeout(resolve, 4000);
        }),
      ]);
      if (typeof reply === 'object' && reply !== null && 'ok' in reply && reply.ok === true) return;
    } catch {
      // A worker that cannot receive the report gets another bounded attempt.
    } finally {
      clearTimeout(timer);
    }
  }
});
