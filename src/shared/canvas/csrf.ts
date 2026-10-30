import { browser } from 'wxt/browser';
import { toCanvasOrigin } from './http';
import type { CsrfTokenSource } from './types';

const CSRF_COOKIE_NAME = '_csrf_token';

/** URL-decodes a cookie value. An empty or malformed value gives null. */
function decodeCookieValue(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    return decodeURIComponent(raw) || null;
  } catch {
    return null;
  }
}

/** Reads the CSRF token with the `cookies` API. For extension pages and the background. */
export function csrfFromCookiesApi(origin: string): CsrfTokenSource {
  const url = `${toCanvasOrigin(origin)}/`;
  return async () => {
    const cookie = await browser.cookies.get({ url, name: CSRF_COOKIE_NAME });
    return decodeCookieValue(cookie?.value);
  };
}
