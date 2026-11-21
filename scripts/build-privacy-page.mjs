import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPOSITORY = 'https://github.com/tranbao0/tools-for-canvas';
const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const LINK_PROTOCOLS = new Set(['https:', 'http:', 'mailto:']);

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (character) => ENTITIES[character]);
}

function renderInline(text) {
  const tokens = /`([^`]+)`|\*\*(.+?)\*\*|\[([^\]]+)\]\(([^\s)]+)\)/g;
  let html = '';
  let end = 0;
  for (const match of text.matchAll(tokens)) {
    const [token, code, bold, label, href] = match;
    html += escapeHtml(text.slice(end, match.index));
    if (code !== undefined) {
      html += `<code>${escapeHtml(code)}</code>`;
    } else if (bold !== undefined) {
      html += `<strong>${renderInline(bold)}</strong>`;
    } else {
      const url = URL.parse(href);
      html +=
        url && LINK_PROTOCOLS.has(url.protocol)
          ? `<a href="${escapeHtml(url.href)}">${renderInline(label)}</a>`
          : escapeHtml(token);
    }
    end = match.index + token.length;
  }
  return html + escapeHtml(text.slice(end));
}

function renderTable(lines) {
  const cells = (line) =>
    line
      .trim()
      .slice(1, -1)
      .split('|')
      .map((cell) => renderInline(cell.trim()));
  const headers = cells(lines[0])
    .map((cell) => `<th scope="col">${cell}</th>`)
    .join('');
  const rows = lines.slice(2).map((line) => {
    const columns = cells(line)
      .map((cell) => `<td>${cell}</td>`)
      .join('');
    return `<tr>${columns}</tr>`;
  });
  return `<table>\n<thead><tr>${headers}</tr></thead>\n<tbody>\n${rows.join('\n')}\n</tbody>\n</table>`;
}

export function renderMarkdown(markdown) {
  return markdown
    .trim()
    .split(/\r?\n(?:[ \t]*\r?\n)+/)
    .map((block) => {
      const lines = block.split(/\r?\n/);
      const heading = /^(#{1,3}) (.+)$/.exec(block);
      if (heading) {
        const level = heading[1].length;
        return `<h${level}>${renderInline(heading[2])}</h${level}>`;
      }
      if (block.startsWith('- ')) {
        const items = block
          .slice(2)
          .split(/\r?\n- /)
          .map((item) => {
            const text = item.replace(/\r?\n[ \t]*/g, ' ');
            return `<li>${renderInline(text)}</li>`;
          });
        return `<ul>\n${items.join('\n')}\n</ul>`;
      }
      if (lines.length > 2 && /^\|(?:\s*-+\s*\|)+$/.test(lines[1])) {
        return renderTable(lines);
      }
      return `<p>${renderInline(lines.join(' '))}</p>`;
    })
    .join('\n\n');
}

function page(title, content) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    :root { color-scheme: light dark; background: #fff; color: #20252b; }
    body { max-width: 72ch; margin: 0 auto; padding: 2rem 1rem; font: 1rem/1.65 system-ui, sans-serif; overflow-wrap: anywhere; }
    h1, h2, h3 { line-height: 1.25; }
    h2 { margin-top: 2em; }
    a { color: #004a9f; }
    li + li { margin-top: .35em; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: .5em; text-align: left; vertical-align: top; border-bottom: 1px solid #777; }
    @media (prefers-color-scheme: dark) {
      :root { background: #17191c; color: #ebeef2; }
      a { color: #9ccaff; }
    }
  </style>
</head>
<body>
<main>
${content}
</main>
</body>
</html>
`;
}

export async function buildPrivacyPage(outDir) {
  const markdown = await readFile(new URL('../docs/privacy.md', import.meta.url), 'utf8');
  const privacyDir = join(outDir, 'privacy');
  await mkdir(privacyDir, { recursive: true });
  await Promise.all([
    writeFile(
      join(privacyDir, 'index.html'),
      page('Privacy policy | Tools for Canvas', renderMarkdown(markdown)),
    ),
    writeFile(
      join(outDir, 'index.html'),
      page(
        'Tools for Canvas',
        `<h1>Tools for Canvas</h1>
<ul>
<li><a href="./privacy/">Privacy policy</a></li>
<li><a href="${REPOSITORY}">GitHub repository</a></li>
</ul>`,
      ),
    ),
  ]);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const outDir = process.argv[2];
  if (!outDir) throw new Error('Usage: node scripts/build-privacy-page.mjs <outDir>');
  await buildPrivacyPage(outDir);
}
