import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildPrivacyPage, renderMarkdown } from './build-privacy-page.mjs';

test('publishes the current privacy policy and a landing page without external resources', async () => {
  const outDir = await mkdtemp(join(tmpdir(), 'canvas-privacy-'));
  try {
    await buildPrivacyPage(outDir);
    const markdown = await readFile(new URL('../docs/privacy.md', import.meta.url), 'utf8');
    const policy = await readFile(join(outDir, 'privacy', 'index.html'), 'utf8');
    const landing = await readFile(join(outDir, 'index.html'), 'utf8');
    assert.ok(policy.includes(renderMarkdown(markdown)));
    for (const heading of markdown.matchAll(/^(#{1,3}) (.+)$/gm)) {
      assert.ok(policy.includes(`<h${heading[1].length}>${heading[2]}</h${heading[1].length}>`));
    }
    assert.match(policy, /<th scope="col">Permission<\/th>/);
    assert.match(policy, /<td><code>cookies<\/code><\/td>/);
    assert.match(landing, /href="\.\/privacy\/"/);
    for (const page of [policy, landing]) {
      assert.match(page, /<html lang="en">/);
      assert.match(page, /prefers-color-scheme: dark/);
      assert.doesNotMatch(
        page,
        /<(?:script|link|iframe|img|object|embed)\b|\bsrc\s*=|@import|url\(/i,
      );
    }
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test('escapes markup, formats inline text and allows only safe link protocols', () => {
  const html = renderMarkdown(
    [
      '### A < B',
      '',
      '- **Bold & bright**',
      '  with `<code>`.',
      '- <script>alert("hello")</script>',
      '',
      '[Web](https://example.com/?a=1&b=2) [HTTP](http://example.com/) [Mail](mailto:test@example.com)',
      '[Bad](javascript:alert) [Data](data:text/html,hello) [Relative](//example.com/)',
    ].join('\n'),
  );
  assert.match(html, /<h3>A &lt; B<\/h3>/);
  assert.match(
    html,
    /<ul>\s*<li><strong>Bold &amp; bright<\/strong> with <code>&lt;code&gt;<\/code>\.<\/li>/,
  );
  assert.match(html, /&lt;script&gt;alert\(&quot;hello&quot;\)&lt;\/script&gt;/);
  assert.match(html, /<a href="https:\/\/example.com\/\?a=1&amp;b=2">Web<\/a>/);
  assert.match(html, /<a href="http:\/\/example.com\/">HTTP<\/a>/);
  assert.match(html, /<a href="mailto:test@example.com">Mail<\/a>/);
  assert.equal([...html.matchAll(/href=/g)].length, 3);
});
