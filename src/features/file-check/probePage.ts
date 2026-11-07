/**
 * The probe page of the file access check (design decision 23). A page of the saved Canvas
 * frames it, and it answers with one message that holds the nonce from its address. It posts
 * only to the saved Canvas origin, which Firefox supplies through a read-only background message, so
 * any other page that frames it gets nothing.
 */
import { browser } from 'wxt/browser';
import { canvasOriginItem } from '../../shared/platform/storage';
import { PROBE_MESSAGE_TYPE } from './protocol';

const NONCE = /^[0-9a-f-]{8,64}$/i;

export async function startFileProbe(win: Window = window): Promise<void> {
  if (win.parent === win) return;
  const nonce = new URLSearchParams(win.location.search).get('n');
  if (nonce === null || !NONCE.test(nonce)) return;
  const reply: unknown =
    import.meta.env.BROWSER === 'firefox'
      ? await browser.runtime.sendMessage({ type: 'weekrow:file-probe-origin' })
      : { canvasOrigin: await canvasOriginItem.getValue() };
  const origin =
    typeof reply === 'object' &&
    reply !== null &&
    'canvasOrigin' in reply &&
    typeof reply.canvasOrigin === 'string'
      ? reply.canvasOrigin
      : null;
  if (origin === null) return;
  win.parent.postMessage({ type: PROBE_MESSAGE_TYPE, nonce }, origin);
}
