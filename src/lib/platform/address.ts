/**
 * Canvas address rules. See docs/design.md, decision 5.
 */
import { isIpHost, parseUrl } from '../model/url';

const SCHEME_PREFIX = /^([a-z][a-z0-9+.-]*):/i;
/** The text after `host:` when it is a port, such as `8443/path` or an empty port. */
const PORT_SUFFIX = /^\d*(?:[/?#]|$)/;
const INSTRUCTURE_DOMAIN = 'instructure.com';
const TEST_OR_BETA_SUFFIXES = ['.test.instructure.com', '.beta.instructure.com'];

/**
 * Gives the input a scheme, or returns `null` for a scheme that is not `https` or `http`.
 * `canvas.school.edu:8443` has no scheme: the part before the colon is a host.
 */
function withScheme(input: string): string | null {
  const match = SCHEME_PREFIX.exec(input);
  if (match === null) return `https://${input}`;
  const scheme = (match[1] ?? '').toLowerCase();
  if (scheme === 'https' || scheme === 'http') return input;
  const rest = input.slice(match[0].length);
  return PORT_SUFFIX.test(rest) ? `https://${input}` : null;
}

/** A dotted host name with no empty label. IP addresses are not Canvas addresses. */
function isAllowedHostname(hostname: string): boolean {
  if (isIpHost(hostname)) return false;
  const labels = hostname.split('.');
  return labels.length > 1 && labels.every((label) => label !== '');
}

/**
 * Reduces a typed or copied address to an `https` origin, such as `https://canvas.school.edu`.
 *
 * It adds `https://` when the input has no scheme, upgrades `http` to `https`, drops the path,
 * query and hash, drops a trailing dot, and lower-cases the host.
 * It returns `null` for empty input, other schemes, IP addresses, hosts without a dot and hosts
 * with an empty label.
 */
export function normalizeAddress(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const text = withScheme(trimmed);
  if (text === null) return null;
  const url = parseUrl(text);
  if (url === null) return null;
  const hostname = url.hostname.replace(/\.$/, '');
  if (!isAllowedHostname(hostname)) return null;
  const port = url.port === '' || url.port === '443' ? '' : `:${url.port}`;
  return `https://${hostname}${port}`;
}

/** The host name of an origin, or `null` when the origin cannot be parsed. */
export function originHostname(origin: string): string | null {
  return parseUrl(origin)?.hostname ?? null;
}

/** Whether the origin is `instructure.com` or one of its subdomains. */
export function isInstructureHost(origin: string): boolean {
  const hostname = originHostname(origin);
  if (hostname === null) return false;
  return hostname === INSTRUCTURE_DOMAIN || hostname.endsWith(`.${INSTRUCTURE_DOMAIN}`);
}

/** Whether the origin is an Instructure test or beta host. Such hosts are never saved automatically. */
export function isTestOrBetaHost(origin: string): boolean {
  const hostname = originHostname(origin);
  if (hostname === null) return false;
  return TEST_OR_BETA_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
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
