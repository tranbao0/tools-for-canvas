import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildPdf, text } from './pdf-builder';
import {
  FIXTURE_LINK,
  FIXTURE_PAGE_COUNT,
  FIXTURE_WORD,
  fixturePdf,
  hostilePdf,
  lecturePdf,
} from './fixture';

const asText = (bytes: Buffer) => bytes.toString('latin1');

describe('the fixture PDF', () => {
  it('is the file that the script writes', () => {
    expect(readFileSync(new URL('./fixture.pdf', import.meta.url)).equals(fixturePdf())).toBe(true);
  });

  it('has 3 pages, a link of each kind on page 1, and the known word on page 2 only', () => {
    const file = asText(fixturePdf());
    expect(file.startsWith('%PDF-1.4')).toBe(true);
    expect(file).toContain(`/Count ${FIXTURE_PAGE_COUNT}`);
    expect(file.match(/\/Type \/Page /g)).toHaveLength(FIXTURE_PAGE_COUNT);
    expect(file.match(new RegExp(FIXTURE_WORD, 'g'))).toHaveLength(1);
    expect(file).toContain(`/URI (${FIXTURE_LINK})`);
    expect(file.match(/\/Subtype \/Link/g)).toHaveLength(2);
    // The word sits in the content stream of the second page.
    const pages = [...file.matchAll(/\/Type \/Page \/Parent 2 0 R[\s\S]*?\/Contents (\d+) 0 R/g)];
    const stream = (number: string) =>
      new RegExp(`\\n${number} 0 obj\\n<< /Length \\d+ >>\\nstream\\n([\\s\\S]*?)endstream`).exec(
        file,
      )?.[1];
    expect(stream(pages[1]![1]!)).toContain(FIXTURE_WORD);
    expect(stream(pages[0]![1]!)).not.toContain(FIXTURE_WORD);
    // Page 1 has a filled rectangle that draws without a font.
    expect(stream(pages[0]![1]!)).toMatch(/ re f\n/);
  });

  it('has a cross-reference table with the true offset of every object', () => {
    const bytes = fixturePdf();
    const file = asText(bytes);
    const start = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(file)![1]);
    expect(file.slice(start, start + 4)).toBe('xref');
    const lines = file.slice(start).split('\n');
    const count = Number(/^0 (\d+)$/.exec(lines[1]!)![1]);
    for (let number = 1; number < count; number += 1) {
      const offset = Number(lines[2 + number]!.slice(0, 10));
      expect(file.slice(offset, offset + `${number} 0 obj`.length)).toBe(`${number} 0 obj`);
    }
    expect(file).toContain(`/Size ${count}`);
  });

  it('escapes the characters that end a string', () => {
    expect(text(0, 0, 10, 'a (b) \\ c')).toContain('(a \\(b\\) \\\\ c)');
    expect(asText(buildPdf([{ content: text(0, 0, 10, 'x') }]))).toContain('%%EOF');
  });
});

describe('the lecture PDF', () => {
  it('has the pages that it is asked for, with text and no link', () => {
    const file = asText(lecturePdf(4));
    expect(file).toContain('/Count 4');
    expect(file).toContain('Hash tables');
    expect(file).not.toContain('/Subtype /Link');
  });
});

describe('the hostile PDF', () => {
  it('holds a script link, a file link, a script action, a form field and a popup note', () => {
    const file = asText(hostilePdf());
    expect(file).toContain('/URI (javascript:alert\\(document.domain\\))');
    expect(file).toContain('/URI (file:///etc/passwd)');
    expect(file).toContain('/OpenAction');
    expect(file).toContain('/Subtype /Widget');
    expect(file).toContain('/Open true');
  });
});

describe('the fax image of the fixture', () => {
  it('is written as ASCII hex, so the file stays plain text', () => {
    const bytes = fixturePdf();
    expect(bytes.every((byte) => byte < 128)).toBe(true);
    expect(asText(bytes)).toContain('/Filter [/ASCIIHexDecode /CCITTFaxDecode]');
  });
});
