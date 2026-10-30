import { browser, type Browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { csrfFromCookiesApi } from '../../../shared/canvas/csrf';
import { CSRF_TOKEN, ORIGIN } from './support';

const ENCODED = encodeURIComponent(CSRF_TOKEN);

type Cookie = Browser.cookies.Cookie;
type CookieLookup = (details: Browser.cookies.CookieDetails) => Promise<Cookie | null | undefined>;

/** `spyOn` types an overloaded function by its last overload, the callback form, so the spy is retyped to the promise form. */
function mockCookieLookup(result: Cookie | null): MockInstance<CookieLookup> {
  return (
    vi.spyOn(browser.cookies, 'get') as unknown as MockInstance<CookieLookup>
  ).mockResolvedValue(result);
}

function cookie(value: string): Cookie {
  return {
    name: '_csrf_token',
    value,
    domain: 'school.instructure.com',
    hostOnly: true,
    path: '/',
    secure: true,
    httpOnly: false,
    sameSite: 'lax' as Browser.cookies.SameSiteStatus,
    session: true,
    storeId: '0',
  };
}

describe('csrfFromCookiesApi', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('reads _csrf_token for the origin with the cookies API and decodes it', async () => {
    const get = mockCookieLookup(cookie(ENCODED));
    await expect(csrfFromCookiesApi(ORIGIN)()).resolves.toBe(CSRF_TOKEN);
    expect(get).toHaveBeenCalledWith({ url: `${ORIGIN}/`, name: '_csrf_token' });
  });

  it('gives null when the cookie is missing, empty or malformed', async () => {
    mockCookieLookup(null);
    await expect(csrfFromCookiesApi(ORIGIN)()).resolves.toBeNull();
    mockCookieLookup(cookie(''));
    await expect(csrfFromCookiesApi(ORIGIN)()).resolves.toBeNull();
    mockCookieLookup(cookie('%E0%A4%A'));
    await expect(csrfFromCookiesApi(ORIGIN)()).resolves.toBeNull();
  });

  it('uses only the origin of the address', async () => {
    const get = mockCookieLookup(null);
    await csrfFromCookiesApi(`${ORIGIN}/courses/1`)();
    expect(get).toHaveBeenCalledWith({ url: `${ORIGIN}/`, name: '_csrf_token' });
  });

  it('refuses an http origin', () => {
    const get = mockCookieLookup(cookie(ENCODED));
    expect(() => csrfFromCookiesApi('http://school.instructure.com')).toThrow(
      expect.objectContaining({ kind: 'origin_blocked' }),
    );
    expect(get).not.toHaveBeenCalled();
  });
});
