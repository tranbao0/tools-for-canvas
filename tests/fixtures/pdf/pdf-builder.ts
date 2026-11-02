/**
 * A small writer of PDF files for the tests. It writes plain PDF 1.4 with the standard fonts
 * Helvetica and Times, rectangles, lines, text, and link annotations. It computes the byte offsets of
 * the cross-reference table, so a viewer reads the file without repair.
 */

export type Rect = [number, number, number, number];

export interface LinkSpec {
  /** The area of the link in points, as `[left, bottom, right, top]`. */
  rect: Rect;
  /** An external address. */
  uri?: string;
  /** An internal destination: the page, counted from 0. */
  page?: number;
}

export interface PageSpec {
  /** The content stream of the page. Build it with {@link text}, {@link fill} and {@link stroke}. */
  content: string;
  links?: LinkSpec[];
}

export const PAGE_WIDTH = 612;
export const PAGE_HEIGHT = 792;

export type Font = 'F1' | 'F2' | 'F3' | 'F4';

function escapeText(value: string): string {
  return value.replace(/[\\()]/g, (char) => `\\${char}`);
}

/** One line of text with its baseline at `(x, y)`. */
export function text(
  x: number,
  y: number,
  size: number,
  value: string,
  font: Font = 'F1',
  color: [number, number, number] = [0, 0, 0],
): string {
  return `BT ${color.join(' ')} rg /${font} ${size} Tf ${x} ${y} Td (${escapeText(value)}) Tj ET\n`;
}

/** A filled rectangle. */
export function fill(
  x: number,
  y: number,
  width: number,
  height: number,
  color: [number, number, number],
): string {
  return `${color.join(' ')} rg ${x} ${y} ${width} ${height} re f\n`;
}

/** A straight line. */
export function stroke(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width = 1,
  color: [number, number, number] = [0, 0, 0],
): string {
  return `${color.join(' ')} RG ${width} w ${x1} ${y1} m ${x2} ${y2} l S\n`;
}

/** The outline of a rectangle. */
export function outline(
  x: number,
  y: number,
  width: number,
  height: number,
  lineWidth = 1,
  color: [number, number, number] = [0, 0, 0],
): string {
  return `${color.join(' ')} RG ${lineWidth} w ${x} ${y} ${width} ${height} re S\n`;
}

const FONTS: Record<Font, string> = {
  F1: 'Helvetica',
  F2: 'Helvetica-Bold',
  F3: 'Times-Roman',
  F4: 'Courier',
};

/** Builds a PDF with the pages in order. */
export function buildPdf(pages: readonly PageSpec[]): Buffer {
  const objects: string[] = [];
  // Object numbers: 1 catalog, 2 page tree, 3 to 6 fonts, then three objects or more per page.
  const fontObjects = Object.keys(FONTS) as Font[];
  const firstPage = 3 + fontObjects.length;
  const pageNumbers: number[] = [];
  let next = firstPage;
  const layout = pages.map((page) => {
    const pageNumber = next;
    const contentNumber = next + 1;
    const annotNumbers = (page.links ?? []).map((_link, index) => next + 2 + index);
    next += 2 + annotNumbers.length;
    pageNumbers.push(pageNumber);
    return { pageNumber, contentNumber, annotNumbers };
  });
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageNumbers.map((n) => `${n} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  fontObjects.forEach((font, index) => {
    objects[3 + index] =
      `<< /Type /Font /Subtype /Type1 /BaseFont /${FONTS[font]} /Encoding /WinAnsiEncoding >>`;
  });
  const fontResources = fontObjects.map((font, index) => `/${font} ${3 + index} 0 R`).join(' ');
  pages.forEach((page, index) => {
    const entry = layout[index]!;
    const annots = entry.annotNumbers.map((n) => `${n} 0 R`).join(' ');
    objects[entry.pageNumber] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << ${fontResources} >> >> /Contents ${entry.contentNumber} 0 R` +
      (annots === '' ? '' : ` /Annots [${annots}]`) +
      ' >>';
    objects[entry.contentNumber] =
      `<< /Length ${Buffer.byteLength(page.content, 'latin1')} >>\nstream\n${page.content}endstream`;
    (page.links ?? []).forEach((link, linkIndex) => {
      const number = entry.annotNumbers[linkIndex]!;
      const action =
        link.uri !== undefined
          ? `/A << /S /URI /URI (${escapeText(link.uri)}) >>`
          : `/Dest [${pageNumbers[link.page ?? 0]} 0 R /Fit]`;
      objects[number] =
        `<< /Type /Annot /Subtype /Link /Rect [${link.rect.join(' ')}] /Border [0 0 0] ${action} >>`;
    });
  });

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let number = 1; number < objects.length; number += 1) {
    offsets[number] = Buffer.byteLength(body, 'latin1');
    body += `${number} 0 obj\n${objects[number]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let number = 1; number < objects.length; number += 1) {
    body += `${String(offsets[number]).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}
