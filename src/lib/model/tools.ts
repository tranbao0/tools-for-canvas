/**
 * Readable names for outside tools, taken from the host of `external_tool_tag_attributes.url`.
 */
import { isIpHost, parseUrl } from './url';

/** Second-level labels of common public suffixes such as `co.uk` or `edu.au`. */
const SECOND_LEVEL_SUFFIX_LABELS = new Set(['ac', 'co', 'com', 'edu', 'gov', 'net', 'org']);

/** Known tools, matched on the registrable domain label. The first match wins. */
const KNOWN_TOOLS: readonly { labels: readonly string[]; name: string }[] = [
  { labels: ['gradescope'], name: 'Gradescope' },
  { labels: ['mheducation', 'mcgraw-hill', 'mcgrawhill'], name: 'McGraw Hill Connect' },
  {
    labels: ['pearson', 'pearsoned', 'pearsoncmg', 'mathxl', 'pearsonmylabandmastering'],
    name: 'Pearson',
  },
  { labels: ['webassign'], name: 'WebAssign' },
  { labels: ['cengage', 'cengagenow'], name: 'Cengage' },
  { labels: ['zybooks', 'zybook'], name: 'zyBooks' },
  { labels: ['wiley', 'wileyplus'], name: 'Wiley' },
  { labels: ['macmillanlearning', 'macmillan'], name: 'Macmillan Achieve' },
  { labels: ['turnitin', 'turnitinuk'], name: 'Turnitin' },
];

/**
 * The label that names the site: `connect` in `connect.mheducation.com` is skipped, and
 * `example` is returned for both `example.com` and `lti.example.co.uk`.
 */
export function registrableLabel(host: string): string | null {
  const labels = host.toLowerCase().replace(/\.$/, '').split('.').filter(Boolean);
  if (labels.length === 0 || isIpHost(host)) return null;
  if (labels.length === 1) return labels[0] ?? null;
  const last = labels[labels.length - 1] ?? '';
  const secondLast = labels[labels.length - 2] ?? '';
  const hasTwoPartSuffix =
    labels.length >= 3 && last.length === 2 && SECOND_LEVEL_SUFFIX_LABELS.has(secondLast);
  return labels[labels.length - (hasTwoPartSuffix ? 3 : 2)] ?? null;
}

function titleCase(label: string): string {
  return label
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function hostOf(url: string): string | null {
  const parsed = parseUrl(url);
  if (parsed === null || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) return null;
  return parsed.hostname || null;
}

/**
 * A readable tool name, such as "Gradescope", from an external tool launch URL.
 * Unknown hosts give a name made from the site label, such as "Perusall" for `app.perusall.com`.
 * Returns `null` when the URL is missing or invalid.
 */
export function toolNameFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const host = hostOf(url);
  if (!host) return null;
  const label = registrableLabel(host);
  if (!label) return null;
  const known = KNOWN_TOOLS.find((tool) => tool.labels.includes(label));
  return known ? known.name : titleCase(label);
}
