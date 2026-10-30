/**
 * URL helpers shared by the model and the platform code.
 */

const IPV4_HOST = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** Parses a URL, or gives `null` when the text is not one. */
export function parseUrl(text: string): URL | null {
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

/** Whether a host name is an IPv4 address or a bracketed IPv6 address. */
export function isIpHost(hostname: string): boolean {
  return IPV4_HOST.test(hostname) || hostname.startsWith('[');
}
