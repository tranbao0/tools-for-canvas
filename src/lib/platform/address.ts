/**
 * Canvas address rules. See docs/design.md, decision 5.
 */
import { isIpHost, parseUrl } from '../model/url';

const INSTRUCTURE_DOMAIN = 'instructure.com';
const TEST_OR_BETA_SUFFIXES = ['.test.instructure.com', '.beta.instructure.com'];

/** A dotted host name with no empty label. IP addresses are not Canvas addresses. */
function isAllowedHostname(hostname: string): boolean {
  if (isIpHost(hostname)) return false;
  const labels = hostname.split('.');
  return labels.length > 1 && labels.every((label) => label !== '');
}

/**
 * Whether the text is an `https` origin that can be a Canvas address, such as
 * `https://canvas.school.edu` or `https://canvas.school.edu:8443`. It has no path, query or
 * credentials, and its host is a dotted name, not an IP address.
 */
export function isUsableOrigin(origin: string): boolean {
  const url = parseUrl(origin);
  return (
    url !== null &&
    url.protocol === 'https:' &&
    url.origin === origin &&
    isAllowedHostname(url.hostname)
  );
}

/** Whether the origin is `instructure.com` or one of its subdomains. */
export function isInstructureHost(origin: string): boolean {
  const hostname = parseUrl(origin)?.hostname;
  if (hostname === undefined) return false;
  return hostname === INSTRUCTURE_DOMAIN || hostname.endsWith(`.${INSTRUCTURE_DOMAIN}`);
}

/** Whether the origin is an Instructure test or beta host. Such hosts are never saved automatically. */
export function isTestOrBetaHost(origin: string): boolean {
  const hostname = parseUrl(origin)?.hostname;
  if (hostname === undefined) return false;
  return TEST_OR_BETA_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

/**
 * Whether a Canvas page on this origin may become the saved address without asking: nothing is
 * saved yet, and the page is on `instructure.com` but not on a test or beta host. A page can
 * copy the Canvas markers, so any other host needs the student's click (decision 5).
 */
export function canAutoSaveOrigin(pageOrigin: string, savedOrigin: string | null): boolean {
  return (
    savedOrigin === null &&
    isUsableOrigin(pageOrigin) &&
    isInstructureHost(pageOrigin) &&
    !isTestOrBetaHost(pageOrigin)
  );
}

/**
 * The match pattern for every page of an origin, such as `https://canvas.school.edu/*`.
 * The pattern has no port, so it also matches an origin with a port.
 * Returns `null` when the origin cannot be parsed.
 */
export function originMatchPattern(origin: string): string | null {
  const url = parseUrl(origin);
  if (url === null || url.hostname === '') return null;
  return `${url.protocol}//${url.hostname}/*`;
}
