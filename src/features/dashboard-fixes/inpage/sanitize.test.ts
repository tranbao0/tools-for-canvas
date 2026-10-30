// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { sanitizeHtml } from './sanitize';

const ORIGIN = 'https://school.instructure.com';

/** The sanitized markup, as a string, for assertions. The page never parses this string. */
function clean(html: string): string {
  const box = document.createElement('div');
  box.append(sanitizeHtml(html, { origin: ORIGIN, doc: document }));
  return box.innerHTML;
}

function parsed(html: string): HTMLElement {
  const box = document.createElement('div');
  box.append(sanitizeHtml(html, { origin: ORIGIN, doc: document }));
  return box;
}

describe('sanitizeHtml: what stays', () => {
  it('keeps the allowed tags and the text', () => {
    expect(clean('<p>One <strong>two</strong> <em>three</em> <b>b</b> <i>i</i> <u>u</u></p>')).toBe(
      '<p>One <strong>two</strong> <em>three</em> <b>b</b> <i>i</i> <u>u</u></p>',
    );
    expect(clean('<h1>a</h1><h2>b</h2><h3>c</h3><h4>d</h4><h5>e</h5><h6>f</h6>')).toBe(
      '<h1>a</h1><h2>b</h2><h3>c</h3><h4>d</h4><h5>e</h5><h6>f</h6>',
    );
    expect(clean('<ul><li>a</li></ul><ol><li>b</li></ol><blockquote>q</blockquote>')).toBe(
      '<ul><li>a</li></ul><ol><li>b</li></ol><blockquote>q</blockquote>',
    );
    expect(clean('a<br>b<pre>x</pre><code>y</code><span>s</span><div>d</div>')).toBe(
      'a<br>b<pre>x</pre><code>y</code><span>s</span><div>d</div>',
    );
  });

  it('keeps a table with the span counts of its cells', () => {
    expect(
      clean(
        '<table><thead><tr><th colspan="2">h</th></tr></thead><tbody><tr><td rowspan="3">a</td><td>b</td></tr></tbody></table>',
      ),
    ).toBe(
      '<table><thead><tr><th colspan="2">h</th></tr></thead><tbody><tr><td rowspan="3">a</td><td>b</td></tr></tbody></table>',
    );
  });

  it('keeps entities as text, never as markup', () => {
    const box = parsed('<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; more</p>');
    expect(box.textContent).toBe('<script>alert(1)</script> & more');
    expect(box.querySelector('script')).toBeNull();
  });

  it('makes every link open in a new tab with noopener noreferrer', () => {
    const link = parsed(
      '<a href="https://example.org/x?y=1" title="t" class="c">go</a>',
    ).querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://example.org/x?y=1');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link?.getAttributeNames().sort()).toEqual(['href', 'rel', 'target']);
  });

  it('resolves relative links and images against the Canvas address', () => {
    const box = parsed(
      '<a href="/courses/1/pages/p">p</a><img src="/courses/1/files/2/preview" alt="pic">',
    );
    expect(box.querySelector('a')?.getAttribute('href')).toBe(`${ORIGIN}/courses/1/pages/p`);
    const image = box.querySelector('img');
    expect(image?.getAttribute('src')).toBe(`${ORIGIN}/courses/1/files/2/preview`);
    expect(image?.getAttribute('alt')).toBe('pic');
    // An image of Canvas keeps its referrer. Only another origin loses it.
    expect(image?.hasAttribute('referrerpolicy')).toBe(false);
  });

  it('loads an image of another origin with no referrer', () => {
    const image = parsed('<img src="https://cdn.example.org/a.png">').querySelector('img');
    expect(image?.getAttribute('src')).toBe('https://cdn.example.org/a.png');
    expect(image?.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(image?.getAttribute('alt')).toBe('');
  });

  it('allows mailto and http links', () => {
    const box = parsed('<a href="mailto:a@b.org">m</a><a href="http://example.org">h</a>');
    expect([...box.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
      'mailto:a@b.org',
      'http://example.org/',
    ]);
  });
});

describe('sanitizeHtml: the hostile corpus', () => {
  const hostile: [string, string][] = [
    ['a script', '<p>a</p><script>window.__x = 1</script><p>b</p>'],
    ['a script in mixed case', '<ScRiPt>window.__x = 1</sCrIpT>'],
    ['a script with a src', '<script src="https://example.org/x.js"></script>'],
    ['an onerror handler', '<img src="https://example.org/x.png" onerror="window.__x = 1">'],
    ['an onerror handler with no src', '<img src=x onerror=alert(1)>'],
    ['an onclick handler', '<p onclick="window.__x = 1">x</p>'],
    ['an onmouseover handler on a link', '<a href="https://a.org" onmouseover="alert(1)">x</a>'],
    ['a javascript link', '<a href="javascript:alert(1)">x</a>'],
    ['a javascript link in mixed case', '<a href="JaVaScRiPt:alert(1)">x</a>'],
    ['a javascript link with a tab inside', '<a href="java\tscript:alert(1)">x</a>'],
    ['a javascript link with a newline inside', '<a href="java\nscript:alert(1)">x</a>'],
    ['a javascript link with a leading space', '<a href="  javascript:alert(1)">x</a>'],
    ['a javascript link with control characters', '<a href="\u0001javascript:alert(1)">x</a>'],
    ['a javascript link with an entity', '<a href="&#106;avascript:alert(1)">x</a>'],
    ['a vbscript link', '<a href="vbscript:msgbox(1)">x</a>'],
    ['a data link', '<a href="data:text/html,<script>alert(1)</script>">x</a>'],
    ['a data image', '<img src="data:image/svg+xml,<svg onload=alert(1)>">'],
    ['a javascript image', '<img src="javascript:alert(1)">'],
    ['an http image', '<img src="http://example.org/x.png">'],
    ['a blob link', '<a href="blob:https://school.instructure.com/1">x</a>'],
    ['a file link', '<a href="file:///etc/passwd">x</a>'],
    ['an svg with a handler', '<svg onload="alert(1)"><circle r="1"/></svg>'],
    ['an svg with a script', '<svg><script>alert(1)</script></svg>'],
    ['an svg link', '<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>'],
    ['an svg animate', '<svg><animate onbegin="alert(1)" attributeName="x" dur="1s"/></svg>'],
    ['math', '<math><mtext><script>alert(1)</script></mtext></math>'],
    ['a style tag', '<style>body{display:none}</style><p>x</p>'],
    ['a style attribute', '<p style="position:fixed;top:0;left:0;width:100vw;height:100vh">x</p>'],
    ['an iframe', '<iframe src="https://example.org"></iframe>'],
    ['an iframe with srcdoc', '<iframe srcdoc="<script>alert(1)</script>"></iframe>'],
    ['a form', '<form action="https://example.org"><input name="p"><button>go</button></form>'],
    ['a form button', '<button formaction="https://example.org">x</button>'],
    ['an object', '<object data="https://example.org/x.swf"></object>'],
    ['an embed', '<embed src="https://example.org/x.swf">'],
    ['a base tag', '<base href="https://evil.example"><a href="/x">x</a>'],
    ['a meta refresh', '<meta http-equiv="refresh" content="0;url=https://evil.example">'],
    ['a link tag', '<link rel="stylesheet" href="https://evil.example/x.css">'],
    ['a video', '<video src="x" onerror="alert(1)"><source src="y"></video>'],
    ['a template', '<template><script>alert(1)</script></template>'],
    [
      'noscript with a handler',
      '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>',
    ],
    ['a textarea trick', '<textarea><script>alert(1)</script></textarea>'],
    ['a title trick', '<title><script>alert(1)</script></title>'],
    ['an xmp trick', '<xmp><script>alert(1)</script></xmp>'],
    [
      'nested tricks',
      '<p><b><i><a href="javascript:alert(1)"><img src=x onerror=alert(1)></a></i></b></p>',
    ],
    ['a broken tag', '<<script>alert(1)//<</script>'],
    [
      'a mutation trick',
      '<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>',
    ],
    ['a namespace trick', '<svg></p><style><a id="</style><img src=1 onerror=alert(1)>">'],
    ['an id and a class', '<div id="x" class="y" data-a="1" aria-label="z">x</div>'],
    [
      'a name attribute',
      '<a name="x" href="https://a.org">x</a><img name="body" src="https://a.org/x.png">',
    ],
  ];

  it.each(hostile)('removes %s', (_name, html) => {
    const box = parsed(html);
    const allowed = new Set(
      'p br strong em b i u ul ol li a h1 h2 h3 h4 h5 h6 blockquote code pre span div img table thead tbody tr th td'.split(
        ' ',
      ),
    );
    const attributes: Record<string, string[]> = {
      a: ['href', 'rel', 'target'],
      img: ['alt', 'loading', 'referrerpolicy', 'src'],
      th: ['colspan', 'rowspan'],
      td: ['colspan', 'rowspan'],
    };
    for (const element of box.querySelectorAll('*')) {
      expect(allowed.has(element.localName), element.localName).toBe(true);
      expect(element.namespaceURI).toBe('http://www.w3.org/1999/xhtml');
      for (const name of element.getAttributeNames()) {
        expect(attributes[element.localName] ?? [], `${element.localName} ${name}`).toContain(name);
      }
    }
    for (const link of box.querySelectorAll('a')) {
      expect(link.getAttribute('href')).toMatch(/^(https?:|mailto:)/);
    }
    for (const image of box.querySelectorAll('img')) {
      expect(image.getAttribute('src')).toMatch(/^https:/);
    }
    // Nothing that looks like code or a handler is left in the markup.
    const markup = box.innerHTML.toLowerCase();
    expect(markup).not.toContain('javascript:');
    expect(markup).not.toContain('onerror');
    expect(markup).not.toContain('onload');
    expect(markup).not.toContain('<script');
    expect(markup).not.toContain('<style');
  });

  it('keeps the text around a dropped link and a dropped tag, but not the text of a script', () => {
    expect(clean('<p>a <a href="javascript:alert(1)">party</a> b</p>')).toBe('<p>a party b</p>');
    expect(clean('<p>a</p><script>secret()</script><p>b</p>')).toBe('<p>a</p><p>b</p>');
    expect(clean('<style>.x{}</style>x')).toBe('x');
    expect(clean('<section><font color="red">kept</font></section>')).toBe('kept');
  });

  it('drops an image with a bad source and keeps nothing of it', () => {
    expect(clean('<img src="javascript:alert(1)" alt="x">')).toBe('');
    expect(clean('<img alt="no source">')).toBe('');
  });

  it('does not run anything while it parses', () => {
    const scope = window as unknown as { __x?: number };
    clean(
      '<img src=x onerror="window.__x = 1"><script>window.__x = 2</script><svg onload="window.__x = 3">',
    );
    expect(scope.__x).toBeUndefined();
  });

  it('makes new nodes in the page document, never moves a parsed node', () => {
    const other = document.implementation.createHTMLDocument('other');
    const box = other.createElement('div');
    box.append(sanitizeHtml('<p>x</p>', { origin: ORIGIN, doc: other }));
    expect(box.querySelector('p')?.ownerDocument).toBe(other);
    const here = parsed('<p>x</p>').querySelector('p');
    expect(here?.ownerDocument).toBe(document);
  });

  it('limits the span counts of a cell to a small number', () => {
    expect(
      clean('<table><tr><td colspan="99999999">a</td><td rowspan="-1">b</td></tr></table>'),
    ).toBe('<table><tbody><tr><td>a</td><td>b</td></tr></tbody></table>');
  });

  it('stays fast and flat on deep and large input', () => {
    const deep = `${'<div>'.repeat(5000)}x${'</div>'.repeat(5000)}`;
    const box = parsed(deep);
    let depth = 0;
    for (let node: Element | null = box.firstElementChild; node; node = node.firstElementChild) {
      depth += 1;
    }
    expect(depth).toBeLessThanOrEqual(41);
    // Beyond the limit the rest is dropped, and nothing throws.
    expect(
      parsed('<span>a</span>'.repeat(20000)).querySelectorAll('span').length,
    ).toBeLessThanOrEqual(5000);
  });

  it('makes no element of an unclosed tag, and no link from an empty address', () => {
    expect(parsed('<a href="javascript:alert(1)"').querySelectorAll('*')).toHaveLength(0);
    expect(clean('<a href="">x</a><a>y</a><a href="  ">z</a>')).toBe('xyz');
  });

  it('returns an empty fragment for an empty message', () => {
    expect(clean('')).toBe('');
    expect(clean('   ')).toBe('');
  });
});
