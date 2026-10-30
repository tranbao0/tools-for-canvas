/**
 * Redaction of addresses and header text for diagnostic reports. A report may go into a bug
 * report or a chat, so it must hold no names, file names, tokens, verifiers or query strings.
 *
 * The rule for a path is a whitelist: a segment stays only when it is a structural word of
 * Canvas, and a numeric id becomes `:id`. Every other segment is dropped. A host name stays.
 */

/** The path segments that a report may show as they are. */
export const STRUCTURAL_SEGMENTS: ReadonlySet<string> = new Set([
  'courses',
  'files',
  'modules',
  'assignments',
  'submissions',
  'download',
  'preview',
  'api',
  'v1',
]);

const CANVAS_ID = /^\d+(?:~\d+)?$/;
const MAX_SEGMENTS = 12;
const MAX_CSP_LENGTH = 3000;

/**
 * Reduces a path to its structural segments. Anything after `?` or `#` goes first. A numeric id
 * becomes `:id`, and every other segment is dropped. The result always starts with `/`.
 */
export function redactPath(path: string): string {
  const end = path.search(/[?#]/);
  const bare = end < 0 ? path : path.slice(0, end);
  const kept: string[] = [];
  for (const segment of bare.split(/[/\\]/)) {
    if (segment === '') continue;
    if (CANVAS_ID.test(segment)) kept.push(':id');
    else if (STRUCTURAL_SEGMENTS.has(segment)) kept.push(segment);
    if (kept.length >= MAX_SEGMENTS) break;
  }
  return `/${kept.join('/')}`;
}

/** The host and the redacted path of an address. */
export interface RedactedUrl {
  host: string;
  path: string;
}

const SAFE_HOST = /^[a-z0-9.:[\]-]{1,255}$/;

/**
 * Splits an address into its host and its redacted path. The user name, the password, the query
 * and the fragment are dropped. An address that is not http or https shows only its scheme in
 * parentheses, because the rest of it (a `data:` or `blob:` address) can hold anything.
 * Returns `null` for text that is not an address.
 */
export function redactUrl(address: string, base?: string): RedactedUrl | null {
  let url: URL;
  try {
    url = new URL(address, base);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { host: `(${url.protocol.replace(/[^a-z0-9+.-]/gi, '')})`, path: '/' };
  }
  const host = SAFE_HOST.test(url.host) ? url.host : '(host)';
  return { host, path: redactPath(url.pathname) };
}

/** `host/path` for a report, or `(not an address)`. */
export function describeUrl(address: string, base?: string): string {
  const url = redactUrl(address, base);
  return url === null ? '(not an address)' : `${url.host}${url.path === '/' ? '' : url.path}`;
}

/** The media type of a `content-type` value, such as `application/pdf`, without parameters. */
export function mediaType(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const type = value.split(';')[0]?.trim().toLowerCase() ?? '';
  if (type === '') return null;
  return /^[a-z0-9][a-z0-9!#$&^_.+-]{0,60}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,100}$/.test(type)
    ? type
    : '(unusual)';
}

/**
 * Shows bytes as text. Printable ASCII stays; every other byte shows as `\xNN`. The bytes of `?`
 * and `#` also show as escapes, so the last pass over a report does not take them for a query.
 */
export function escapeBytes(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) {
    if (byte === 0x5c) text += '\\\\';
    else if (byte >= 0x20 && byte <= 0x7e && byte !== 0x3f && byte !== 0x23) {
      text += String.fromCharCode(byte);
    } else text += `\\x${byte.toString(16).padStart(2, '0')}`;
  }
  return text;
}

const CSP_DIRECTIVES: ReadonlySet<string> = new Set([
  'default-src',
  'script-src',
  'script-src-elem',
  'script-src-attr',
  'style-src',
  'style-src-elem',
  'style-src-attr',
  'img-src',
  'font-src',
  'connect-src',
  'media-src',
  'object-src',
  'child-src',
  'frame-src',
  'worker-src',
  'manifest-src',
  'prefetch-src',
  'base-uri',
  'form-action',
  'frame-ancestors',
  'sandbox',
  'report-uri',
  'report-to',
  'upgrade-insecure-requests',
  'block-all-mixed-content',
  'require-trusted-types-for',
  'trusted-types',
  'navigate-to',
  'plugin-types',
]);
const CSP_KEYWORD =
  /^'(?:self|none|unsafe-inline|unsafe-eval|unsafe-hashes|strict-dynamic|wasm-unsafe-eval|report-sample|inline-speculation-rules|script|style)'$/;
const CSP_HOST = /^[a-z0-9*.:-]{1,255}$/i;
const CSP_SCHEME = /^[a-z][a-z0-9+.-]{0,20}:$/;

/** One source of a CSP directive, with nonces, hashes, paths and queries removed. */
function redactCspSource(token: string): string {
  if (token.startsWith("'")) {
    if (/^'nonce-/i.test(token)) return "'nonce-REDACTED'";
    if (/^'(?:sha|md)\d*-/i.test(token)) return "'hash-REDACTED'";
    return CSP_KEYWORD.test(token) ? token : "'REDACTED'";
  }
  if (CSP_SCHEME.test(token)) return token;
  const schemeEnd = token.indexOf('://');
  if (schemeEnd >= 0) {
    const scheme = token.slice(0, schemeEnd).toLowerCase();
    if (!/^[a-z][a-z0-9+.-]{0,20}$/.test(scheme)) return '(source)';
    const rest = token.slice(schemeEnd + 3);
    const hostEnd = rest.search(/[/?#]/);
    const host = hostEnd < 0 ? rest : rest.slice(0, hostEnd);
    const path = hostEnd < 0 ? '/' : redactPath(rest.slice(hostEnd));
    return `${scheme}://${CSP_HOST.test(host) ? host.toLowerCase() : '(host)'}${path === '/' ? '' : path}`;
  }
  // A host source such as `*.example.com:443/path`: keep the host and the port.
  const host = token.split(/[/?#]/)[0] ?? '';
  return CSP_HOST.test(host) ? host : '(source)';
}

/**
 * A content security policy as text, safe to put in a report. Nonces and hashes are removed.
 * Every address keeps its host and its structural path only. The value of `report-to` is
 * dropped, because it names a group and not a source. A directive with an unknown name is dropped.
 */
export function redactCsp(policy: string): string {
  const directives: string[] = [];
  for (const part of policy.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    const directive = name?.toLowerCase() ?? '';
    // A name that is not a known directive could hold anything, so it is dropped.
    if (!CSP_DIRECTIVES.has(directive)) continue;
    const kept = directive === 'report-to' ? [] : sources.slice(0, 60).map(redactCspSource);
    directives.push([directive, ...kept].join(' '));
  }
  const text = directives.join('; ');
  return text.length > MAX_CSP_LENGTH ? `${text.slice(0, MAX_CSP_LENGTH)}...` : text;
}

/**
 * The last guard over a finished report. It removes what the earlier steps should have removed
 * already: a query string or fragment, a user name in an address, and long opaque strings such as
 * tokens, verifiers and web tokens.
 */
export function scrubReport(text: string): string {
  return text
    .replace(
      /[a-z][a-z0-9+.-]*:\/\/[^\s/@]*@/gi,
      (match) => `${match.slice(0, match.indexOf('://') + 3)}`,
    )
    .replace(/[?#][^\s]*/g, '')
    .replace(/[A-Za-z0-9_~+=-]{32,}/g, (value) =>
      // A long word of lower case letters and hyphens is a label, not a token.
      /[0-9A-Z_~+=]/.test(value) ? '[long value removed]' : value,
    );
}
