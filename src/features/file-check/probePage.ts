/**
 * The probe page of the file access check (design decision 23). A page of the saved Canvas
 * frames it, and it answers with one message that holds the nonce from its address. It posts
 * only to the saved Canvas origin, which it reads from the trusted storage of the extension, so
 * any other page that frames it gets nothing.
 */
import { canvasOriginItem } from '../../shared/platform/storage';
import { PROBE_MESSAGE_TYPE } from './protocol';

const NONCE = /^[0-9a-f-]{8,64}$/i;

export async function startFileProbe(win: Window = window): Promise<void> {
  if (win.parent === win) return;
  const nonce = new URLSearchParams(win.location.search).get('n');
  if (nonce === null || !NONCE.test(nonce)) return;
  const origin = await canvasOriginItem.getValue();
  if (origin === null) return;
  win.parent.postMessage({ type: PROBE_MESSAGE_TYPE, nonce }, origin);
}
