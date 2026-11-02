/**
 * The PDFs of the viewer tests.
 *
 * `fixturePdf` is small and fixed: 3 pages, the word below on page 2 only, an external link and
 * an internal link on page 1, and a filled rectangle on page 1 that draws without any font.
 * `tests/fixtures/pdf/fixture.pdf` holds its bytes. Run `node tests/fixtures/pdf/make-fixture.ts`
 * to write the file again.
 *
 * `lecturePdf` is a longer document that looks like lecture notes, for the screenshots.
 */
import {
  PAGE_HEIGHT,
  PAGE_WIDTH,
  buildPdf,
  fill,
  type ImageSpec,
  outline,
  stroke,
  text,
  type PageSpec,
} from './pdf-builder.ts';

/** The word that only page 2 of the fixture holds. */
export const FIXTURE_WORD = 'zebrafish';
export const FIXTURE_PAGE_COUNT = 3;
export const FIXTURE_LINK = 'https://example.com/syllabus';

/**
 * A scanned-page image: 8 by 8 pixels, a black bar over columns 2 to 5, coded as CCITT Group 4
 * fax (the coding of library scans), written as hex text. Only a decoder for fax data can draw it.
 */
export const FAX_IMAGE: ImageSpec = {
  name: 'Fax1',
  width: 8,
  height: 8,
  filters: ['ASCIIHexDecode', 'CCITTFaxDecode'],
  decodeParms: ['null', '<< /K -1 /Columns 8 /Rows 8 >>'],
  hex: '2EFFFFFF001001',
};

/** Where the fax image sits on page 1: the box in points, as `[left, bottom, size]`. */
export const FAX_BOX = { left: 400, bottom: 500, size: 120 } as const;

export function fixturePdf(): Buffer {
  const pages: PageSpec[] = [
    {
      content:
        fill(0, PAGE_HEIGHT - 120, PAGE_WIDTH, 120, [0.17, 0.48, 0.74]) +
        text(48, PAGE_HEIGHT - 70, 28, 'Fixture document', 'F2', [1, 1, 1]) +
        text(48, PAGE_HEIGHT - 200, 14, 'This is page one.') +
        text(48, PAGE_HEIGHT - 240, 14, 'Course syllabus', 'F1', [0.05, 0.4, 0.7]) +
        text(48, PAGE_HEIGHT - 280, 14, 'Jump to page two', 'F1', [0.05, 0.4, 0.7]) +
        `q ${FAX_BOX.size} 0 0 ${FAX_BOX.size} ${FAX_BOX.left} ${FAX_BOX.bottom} cm /${FAX_IMAGE.name} Do Q\n`,
      images: [FAX_IMAGE],
      links: [
        { rect: [48, PAGE_HEIGHT - 244, 160, PAGE_HEIGHT - 226], uri: FIXTURE_LINK },
        { rect: [48, PAGE_HEIGHT - 284, 170, PAGE_HEIGHT - 266], page: 1 },
      ],
    },
    {
      content:
        text(48, PAGE_HEIGHT - 80, 22, 'Second page', 'F2') +
        text(48, PAGE_HEIGHT - 120, 14, `The ${FIXTURE_WORD} is the known word of this file.`),
    },
    {
      content:
        text(48, PAGE_HEIGHT - 80, 22, 'Third page', 'F2') +
        text(48, PAGE_HEIGHT - 120, 14, 'This is the last page.'),
    },
  ];
  return buildPdf(pages);
}

/**
 * A file that tries what a hostile PDF tries: a link with a script address, a script that runs
 * when the file opens, a form field, and a note with a popup.
 */
export function hostilePdf(): Buffer {
  return buildPdf(
    [
      {
        content: text(48, PAGE_HEIGHT - 80, 18, 'Hostile document', 'F2'),
        links: [
          { rect: [48, 600, 200, 620], uri: 'javascript:alert(document.domain)' },
          { rect: [48, 560, 200, 580], uri: 'file:///etc/passwd' },
          { rect: [48, 520, 200, 540], uri: 'https://example.com/ok' },
        ],
        annots: [
          '<< /Type /Annot /Subtype /Widget /FT /Tx /T (field) /V (typed) /Rect [48 400 248 420] /F 4 >>',
          '<< /Type /Annot /Subtype /Text /Contents (note) /Rect [300 400 320 420] /Open true /F 4 >>',
        ],
      },
    ],
    { catalog: '/OpenAction << /S /JavaScript /JS (app.alert\\(1\\)) >>' },
  );
}

/** Breaks a paragraph into lines of at most `width` characters. */
function wrap(paragraph: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of paragraph.split(' ')) {
    if (line !== '' && `${line} ${word}`.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line === '' ? word : `${line} ${word}`;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}

const BODY: readonly string[] = [
  'A hash table stores key and value pairs. A hash function turns a key into an index of an array, so a lookup needs one computation and one array read when the table has few collisions.',
  'Two keys can map to the same index. This is a collision. Chaining keeps a short list of entries at each index. Open addressing probes other indexes of the array until it finds a free one.',
  'The load factor is the number of entries divided by the number of slots. A table that grows when the load factor passes a limit keeps the average cost of an insert and a lookup constant.',
  'Choose a hash function that spreads similar keys over the whole array. A poor function sends many keys to a few slots and makes the table as slow as a list.',
];

function lecturePage(number: number, total: number): PageSpec {
  const margin = 56;
  let content =
    fill(0, PAGE_HEIGHT - 8, PAGE_WIDTH, 8, [0.17, 0.48, 0.74]) +
    text(
      margin,
      PAGE_HEIGHT - 44,
      10,
      'CS 146 - Data Structures and Algorithms',
      'F1',
      [0.35, 0.4, 0.45],
    ) +
    stroke(margin, PAGE_HEIGHT - 52, PAGE_WIDTH - margin, PAGE_HEIGHT - 52, 0.5, [0.8, 0.82, 0.84]);
  let y = PAGE_HEIGHT - 96;
  content += text(margin, y, 24, `Lecture ${number + 4}: Hash tables`, 'F2', [0.15, 0.2, 0.25]);
  y -= 36;
  const paragraph = BODY[number % BODY.length] ?? '';
  for (const line of wrap(paragraph, 84)) {
    content += text(margin, y, 11, line, 'F3');
    y -= 16;
  }
  y -= 12;
  content += text(margin, y, 15, 'Key ideas', 'F2');
  y -= 24;
  for (const item of [
    'Hash the key to an index',
    'Resolve collisions',
    'Resize at a load factor limit',
  ]) {
    content +=
      fill(margin + 4, y + 3, 4, 4, [0.17, 0.48, 0.74]) + text(margin + 16, y, 11, item, 'F3');
    y -= 18;
  }
  y -= 14;
  content += text(margin, y, 15, 'Cost of the main operations', 'F2');
  y -= 12;
  const rows = [
    ['Operation', 'Average case', 'Worst case'],
    ['Insert', 'O(1)', 'O(n)'],
    ['Lookup', 'O(1)', 'O(n)'],
    ['Delete', 'O(1)', 'O(n)'],
  ];
  const columns = [margin, margin + 180, margin + 320];
  rows.forEach((row, rowIndex) => {
    const top = y - rowIndex * 24;
    if (rowIndex === 0) content += fill(margin, top - 24, 420, 24, [0.92, 0.94, 0.95]);
    row.forEach((cell, column) => {
      content += text(
        (columns[column] ?? margin) + 8,
        top - 16,
        11,
        cell,
        rowIndex === 0 ? 'F2' : 'F1',
      );
    });
    content += stroke(margin, top - 24, margin + 420, top - 24, 0.5, [0.75, 0.78, 0.8]);
  });
  y -= rows.length * 24 + 28;
  content += text(margin, y, 15, 'Example', 'F2');
  y -= 18;
  for (let slot = 0; slot < 5; slot += 1) {
    const x = margin + slot * 72;
    content +=
      outline(x, y - 30, 64, 30, 1, [0.3, 0.35, 0.4]) + text(x + 6, y - 20, 10, `[${slot}]`, 'F4');
  }
  content +=
    fill(margin + 72 + 8, y - 24, 48, 18, [1, 0.84, 0.3]) +
    text(margin + 72 + 14, y - 18, 9, 'cat', 'F4');
  content +=
    fill(margin + 216 + 8, y - 24, 48, 18, [0.6, 0.85, 0.7]) +
    text(margin + 216 + 14, y - 18, 9, 'dog', 'F4');
  y -= 70;
  for (const line of wrap(BODY[(number + 1) % BODY.length] ?? '', 84)) {
    content += text(margin, y, 11, line, 'F3');
    y -= 16;
  }
  content +=
    stroke(margin, 56, PAGE_WIDTH - margin, 56, 0.5, [0.8, 0.82, 0.84]) +
    text(margin, 40, 9, 'Week 5 notes', 'F1', [0.35, 0.4, 0.45]) +
    text(
      PAGE_WIDTH - margin - 40,
      40,
      9,
      `Page ${number + 1} of ${total}`,
      'F1',
      [0.35, 0.4, 0.45],
    );
  return { content };
}

export function lecturePdf(pageCount = 6): Buffer {
  return buildPdf(
    Array.from({ length: pageCount }, (_unused, index) => lecturePage(index, pageCount)),
  );
}
