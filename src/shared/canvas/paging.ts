const LINK_ENTRY = /<([^>]*)>([^<]*)/g;
const REL_PARAM = /;\s*rel\s*=\s*(?:"([^"]*)"|([^\s;,]+))/i;

function relValues(params: string): string[] {
  const match = REL_PARAM.exec(params);
  const value = match?.[1] ?? match?.[2] ?? '';
  return value.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Returns the `rel="next"` URL of a `Link` header, or null on the last page. */
export function findNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const [, url, params] of linkHeader.matchAll(LINK_ENTRY)) {
    if (url !== undefined && params !== undefined && relValues(params).includes('next')) return url;
  }
  return null;
}
