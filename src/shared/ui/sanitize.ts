/**
 * The sanitizer for the HTML that teachers write (design decision 22, "Sanitizer rules").
 *
 * The input is hostile. The sanitizer parses it with `DOMParser`, which makes an inert document
 * (no script runs, no image loads), and walks it. For every node of the parsed document it builds
 * a new node in the page document with `createElement`, and only for a tag and an attribute on the
 * allowlist below. No parsed node moves into the page and no string becomes markup, so no tag or
 * attribute that the list does not name can reach the page. It never serializes and parses again,
 * which is the source of mutation XSS.
 *
 * Rules:
 * - Tags: p, br, strong, em, b, i, u, ul, ol, li, a, h1 to h6, blockquote, code, pre, span, div,
 *   img, table, thead, tbody, tr, th and td. An element must be in the HTML namespace.
 * - Attributes: `href` on a, `src` and `alt` on img, `colspan` and `rowspan` on th and td.
 *   Nothing else, so there is no style, no class, no id and no event handler.
 * - Links: only http, https and mailto, resolved against the Canvas address. They open in a new
 *   tab with `rel="noopener noreferrer"`. A link with another scheme loses its link and keeps its
 *   text.
 * - Images: only https, resolved against the Canvas address. Another scheme drops the image. An
 *   image from another origin than Canvas is fetched with no referrer.
 * - Elements that carry code or a foreign document drop with everything inside: script, style,
 *   iframe, object, embed, svg, math, form and the like. Any other tag that is not on the
 *   allowlist drops itself and keeps its sanitized children, so the text stays.
 */

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

const ALLOWED_TAGS: ReadonlySet<string> = new Set(
  'p br strong em b i u ul ol li a h1 h2 h3 h4 h5 h6 blockquote code pre span div img table thead tbody tr th td'.split(
    ' ',
  ),
);

/** Tags that drop with their content. A tag on neither list drops itself and keeps its children. */
const DROPPED_TAGS: ReadonlySet<string> = new Set(
  'script style iframe frame frameset object embed applet svg math form input button select option textarea template noscript noembed noframes link meta base head title audio video source track canvas map area xmp plaintext dialog'.split(
    ' ',
  ),
);

const LINK_SCHEMES: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:']);

/** The deepest nesting that is kept, and the most nodes. Beyond them only text stays. */
const MAX_DEPTH = 40;
const MAX_LEVEL = 200;
const MAX_NODES = 5000;
const MAX_SPAN = 100;

export interface SanitizeOptions {
  /** The Canvas origin: relative links and images resolve against it. */
  origin: string;
  /** The document that gets the new nodes. */
  doc: Document;
}

function resolve(value: string, origin: string): URL | null {
  // No address is not the address of the Canvas page.
  if (value === '') return null;
  try {
    return new URL(value, `${origin}/`);
  } catch {
    return null;
  }
}

/** A span count that table cells accept, or `null`. */
function spanOf(value: string | null): string | null {
  if (value === null || !/^\s*\d{1,3}\s*$/.test(value)) return null;
  const count = Number(value);
  return count >= 1 && count <= MAX_SPAN ? String(count) : null;
}

/** Sanitizes `html` into a fragment of new nodes of `options.doc`. */
export function sanitizeHtml(html: string, options: SanitizeOptions): DocumentFragment {
  const { doc, origin } = options;
  const source = new DOMParser().parseFromString(html, 'text/html');
  const fragment = doc.createDocumentFragment();
  let budget = MAX_NODES;

  /** The node that stands for an allowed element, or `null` when the element drops or unwraps. */
  function create(element: Element): HTMLElement | null {
    const tag = element.localName;
    const made = doc.createElement(tag);
    switch (tag) {
      case 'a': {
        const url = resolve(element.getAttribute('href')?.trim() ?? '', origin);
        if (url === null || !LINK_SCHEMES.has(url.protocol)) return null;
        made.setAttribute('href', url.href);
        made.setAttribute('target', '_blank');
        made.setAttribute('rel', 'noopener noreferrer');
        break;
      }
      case 'img': {
        const url = resolve(element.getAttribute('src')?.trim() ?? '', origin);
        if (url === null || url.protocol !== 'https:') return null;
        made.setAttribute('src', url.href);
        made.setAttribute('alt', element.getAttribute('alt') ?? '');
        made.setAttribute('loading', 'lazy');
        if (url.origin !== origin) made.setAttribute('referrerpolicy', 'no-referrer');
        break;
      }
      case 'th':
      case 'td':
        for (const name of ['colspan', 'rowspan']) {
          const count = spanOf(element.getAttribute(name));
          if (count !== null) made.setAttribute(name, count);
        }
        break;
    }
    return made;
  }

  function walk(parent: Node, into: Node, depth: number, level = 0): void {
    // A parser that allows very deep nesting must not exhaust the stack.
    if (level > MAX_LEVEL) return;
    for (const node of parent.childNodes) {
      if (budget-- <= 0) return;
      if (node.nodeType === 3) {
        into.appendChild(doc.createTextNode((node as Text).data));
        continue;
      }
      if (node.nodeType !== 1) continue;
      const element = node as Element;
      const tag = element.localName;
      if (element.namespaceURI !== HTML_NAMESPACE || DROPPED_TAGS.has(tag)) continue;
      const made = ALLOWED_TAGS.has(tag) && depth < MAX_DEPTH ? create(element) : null;
      if (made === null) {
        // The tag drops, but its text stays.
        walk(element, into, depth, level + 1);
        continue;
      }
      if (tag === 'img') {
        into.appendChild(made);
        continue;
      }
      into.appendChild(made);
      walk(element, made, depth + 1, level + 1);
    }
  }

  if (source.body) walk(source.body, fragment, 0);
  return fragment;
}

/** Tags that end a line of text, so the text of two of them never runs together. */
const BREAKING_TAGS: ReadonlySet<string> = new Set(
  'p br div li ul ol h1 h2 h3 h4 h5 h6 blockquote pre table tr th td'.split(' '),
);

/**
 * The plain text of `html`, cut to `maxLength` characters, for a preview. It reads an inert
 * document: no script runs and no image loads. Elements that carry code or a foreign document
 * (script, style, svg and the like) add no text. The result is text to show as text, never markup.
 */
export function htmlToText(html: string, maxLength: number): string {
  const source = new DOMParser().parseFromString(html, 'text/html');
  const parts: string[] = [];
  let length = 0;
  let budget = MAX_NODES;

  function walk(parent: Node, level: number): void {
    if (level > MAX_LEVEL) return;
    for (const node of parent.childNodes) {
      if (length > maxLength || budget-- <= 0) return;
      if (node.nodeType === 3) {
        const text = (node as Text).data;
        parts.push(text);
        length += text.length;
      } else if (node.nodeType === 1) {
        const element = node as Element;
        const tag = element.localName;
        if (element.namespaceURI !== HTML_NAMESPACE || DROPPED_TAGS.has(tag)) continue;
        const breaks = BREAKING_TAGS.has(tag);
        if (breaks) parts.push(' ');
        walk(element, level + 1);
        if (breaks) parts.push(' ');
      }
    }
  }

  if (source.body) walk(source.body, 0);
  const text = parts.join('').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength).trimEnd()}…` : text;
}
