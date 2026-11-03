// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  decodeText,
  imageFits,
  MAX_SVG_PIXELS,
  MAX_TEXT_BYTES,
  playerType,
  sniffRaster,
  svgBudget,
  svgDrawSize,
} from './player';
import { catchesDownload, fileTarget, frameFileTarget } from '../model';

describe('passive file players', () => {
  it('routes supported images and media', () => {
    for (const ext of ['png', 'jpeg', 'gif', 'webp', 'avif', 'svg'])
      expect(playerType('', `file.${ext}`)?.kind).toBe('image');
    expect(playerType('audio/ogg', 'sound.ogg')?.kind).toBe('audio');
    expect(playerType('video/webm', 'clip.webm')?.kind).toBe('video');
    expect(
      playerType(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'file.docx',
      ),
    ).toBeNull();
  });
  it('keeps markup as text and limits its bytes', () => {
    expect(playerType('text/plain', 'file.txt')?.kind).toBe('text');
    expect(decodeText(new TextEncoder().encode('<script>alert(1)</script>'))).toBe(
      '<script>alert(1)</script>',
    );
    expect(decodeText(new Uint8Array(MAX_TEXT_BYTES + 1).fill(65))).toHaveLength(MAX_TEXT_BYTES);
    expect(decodeText(new Uint8Array([0xe9]))).toBe('é');
  });
  it('keeps UTF-8 when the limit cuts a character in half', () => {
    const bytes = new Uint8Array(MAX_TEXT_BYTES + 2).fill(65);
    bytes[0] = 0xc3;
    bytes[1] = 0xbc;
    bytes[MAX_TEXT_BYTES - 1] = 0xc3;
    bytes[MAX_TEXT_BYTES] = 0xa9;
    const text = decodeText(bytes);
    expect(text.startsWith('\u00fcA')).toBe(true);
    expect(text).toHaveLength(MAX_TEXT_BYTES - 2);
  });
});
describe('submission attachment paths', () => {
  const origin = 'https://canvas.example';
  /** A link inside the markup of a Canvas page. */
  function linkIn(markup: string, href: string): Element {
    document.body.innerHTML = markup.replace('HREF', href);
    return document.querySelector('a')!;
  }
  const SIDEBAR =
    '<aside id="right-side"><div class="details"><div class="content"><div><a href="HREF" download>f</a></div></div></div></aside>';
  const DESCRIPTION =
    '<div id="content"><div class="description user_content"><p><a href="HREF" download>f</a></p></div></div>';
  const COMMENT =
    '<aside id="right-side"><div class="details"><div class="content"><div class="comments module"><div class="comment"><div class="comment_attachments"><div class="comment_attachment"><a href="HREF" download>f</a></div></div></div></div></div></div></aside>';

  it('takes the file of a submission download link', () => {
    const href = '/courses/12/assignments/3/submissions/7?download=42';
    expect(fileTarget(href, origin)).toEqual({ fileId: '42' });
    expect(fileTarget('/courses/12/assignments/3/submissions/7?download=x', origin)).toBeNull();
    expect(fileTarget('/courses/12/assignments/3?download=42', origin)).toBeNull();
  });
  for (const href of [
    '/files/42/download?download_frd=1&verifier=secret',
    '/courses/12/files/42/download?verifier=secret',
    '/courses/12/assignments/3/submissions/7?download=42',
    '/courses/12/assignments/3/anonymous_submissions/aB12z?download=42',
  ]) {
    it(`takes only the identity from ${href}`, () => {
      expect(fileTarget(href, origin)).toEqual({ fileId: '42' });
      for (const markup of [SIDEBAR]) {
        const link = linkIn(markup, href);
        expect(catchesDownload(link, href, origin, '/courses/12/assignments/3')).toBe(true);
        // The submission details page has no such list in its top frame.
        expect(catchesDownload(link, href, origin, '/courses/12/assignments/3/submissions/7')).toBe(
          false,
        );
        expect(catchesDownload(link, href, origin, '/courses/12/files')).toBe(false);
        expect(
          catchesDownload(
            link,
            `https://other.example${href}`,
            origin,
            '/courses/12/assignments/3',
          ),
        ).toBe(false);
      }
    });
  }
  it('takes a comment attachment as its own route', () => {
    const href = '/courses/12/assignments/3/submissions/7?download=42&comment_id=9';
    expect(fileTarget(href, origin)).toEqual({
      fileId: '/courses/12/assignments/3/submissions/7?comment_id=9&download=42',
    });
    expect(fileTarget('/courses/12/assignments/3/submissions/7?download=42', origin)).toEqual({
      fileId: '42',
    });
  });
  it('keeps the download of a teacher button in the description and of a comment attachment', () => {
    const href = '/files/42/download?download_frd=1';
    for (const markup of [DESCRIPTION, COMMENT]) {
      const link = linkIn(markup, href);
      expect(catchesDownload(link, href, origin, '/courses/12/assignments/3')).toBe(false);
      expect(catchesDownload(link, href, origin, '/courses/12/assignments/3/submissions/7')).toBe(
        false,
      );
    }
  });
  it('keeps a download link inside a description even when it sits in a submission container', () => {
    const href = '/files/42/download';
    document.body.innerHTML =
      '<aside id="right-side"><div class="details"><div class="content"><div class="user_content"><a href="/files/42/download" download>f</a></div></div></div></aside>';
    expect(
      catchesDownload(document.querySelector('a')!, href, origin, '/courses/12/assignments/3'),
    ).toBe(false);
  });
  it('keeps a download link outside every submission container', () => {
    const href = '/files/42/download';
    document.body.innerHTML = '<main><a href="/files/42/download" download>f</a></main>';
    expect(
      catchesDownload(document.querySelector('a')!, href, origin, '/courses/12/assignments/3'),
    ).toBe(false);
  });
});

describe('files list in the submission frame', () => {
  const origin = 'https://canvas.example';
  const path = '/courses/12/assignments/3/submissions/7';
  const href = `${path}?download=42`;
  const row = (link: string) =>
    `<table class="file-upload-submission-table"><tr class="file-upload-submission"><td class="file-upload-submission-info">${link}</td><td><a role="button" class="modal_preview_link Button--link" href="${href}">Preview</a></td></tr></table>`;
  const FILE = `<a href="${href}" class="text file-upload-submission-info__link">f.pdf</a>`;
  const linkIn = (markup: string, selector = 'a') => {
    document.body.innerHTML = markup;
    return document.querySelector(selector)!;
  };

  it('takes the file of a link in the files list, with no download attribute', () => {
    expect(frameFileTarget(linkIn(row(FILE)), href, origin, path)).toEqual({ fileId: '42' });
    const direct = '/files/42/download?download_frd=1&verifier=secret';
    const other = `<a href="${direct}" class="file-upload-submission-info__link">f</a>`;
    expect(frameFileTarget(linkIn(row(other)), direct, origin, path)).toEqual({ fileId: '42' });
  });
  it('leaves the Preview button of the row to Canvas', () => {
    expect(
      frameFileTarget(linkIn(row(FILE), '.modal_preview_link'), href, origin, path),
    ).toBeNull();
  });
  it('takes no comment attachment, no link outside the list, and no other page', () => {
    const comment = `${path}?comment_id=9&download=42`;
    const attachment = `<a href="${comment}" class="file-upload-submission-info__link">f</a>`;
    expect(frameFileTarget(linkIn(row(attachment)), comment, origin, path)).toBeNull();
    const outside = `<main><a href="${href}" class="file-upload-submission-info__link">f</a></main>`;
    expect(frameFileTarget(linkIn(outside), href, origin, path)).toBeNull();
    const inComment = `<div class="comments"><div class="comment_attachments">${row(FILE)}</div></div>`;
    expect(frameFileTarget(linkIn(inComment), href, origin, path)).toBeNull();
    const link = linkIn(row(FILE));
    expect(frameFileTarget(link, href, origin, '/courses/12/assignments/3')).toBeNull();
    expect(frameFileTarget(link, href, origin, '/courses/12/files/42')).toBeNull();
    expect(frameFileTarget(link, `https://other.example${href}`, origin, path)).toBeNull();
    expect(frameFileTarget(link, '/courses/12/modules/items/9', origin, path)).toBeNull();
  });
});

describe('sniffRaster', () => {
  const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));
  it('names the raster formats by their first bytes', () => {
    expect(sniffRaster(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe(
      'image/png',
    );
    expect(sniffRaster(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffRaster(new Uint8Array(ascii('GIF89a....')))).toBe('image/gif');
    expect(sniffRaster(new Uint8Array(ascii('GIF87a....')))).toBe('image/gif');
    expect(sniffRaster(new Uint8Array([...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WEBPVP8 ')]))).toBe(
      'image/webp',
    );
    expect(sniffRaster(new Uint8Array([0, 0, 0, 24, ...ascii('ftypavif')]))).toBe('image/avif');
    expect(sniffRaster(new Uint8Array([0, 0, 0, 24, ...ascii('ftypmif1')]))).toBe('image/avif');
    expect(sniffRaster(new Uint8Array([0, 0, 0, 24, ...ascii('ftypheic')]))).toBeNull();
  });
  it('names nothing for markup, text or a short file', () => {
    expect(
      sniffRaster(new Uint8Array(ascii('<svg xmlns="http://www.w3.org/2000/svg"/>'))),
    ).toBeNull();
    expect(sniffRaster(new Uint8Array(ascii('<?xml version="1.0"?><svg/>')))).toBeNull();
    expect(sniffRaster(new Uint8Array(ascii('GIF')))).toBeNull();
    expect(sniffRaster(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(sniffRaster(new Uint8Array())).toBeNull();
  });
});

describe('svgDrawSize', () => {
  const bytes = (text: string) => new TextEncoder().encode(text);
  it('reads width and height, or the view box when the file has no size', () => {
    expect(
      svgDrawSize(bytes('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"/>')),
    ).toEqual({
      width: 300,
      height: 200,
    });
    expect(
      svgDrawSize(bytes('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"/>')),
    ).toEqual({
      width: 1024,
      height: 512,
    });
    expect(
      svgDrawSize(
        bytes('<svg xmlns="http://www.w3.org/2000/svg" width="200" viewBox="0 0 100 50"/>'),
      ),
    ).toEqual({ width: 200, height: 100 });
  });
  it('gives nothing for a file with no usable size, and never runs a script', () => {
    expect(svgDrawSize(bytes('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(svgDrawSize(bytes('<html/>'))).toBeNull();
    expect(svgDrawSize(bytes('not xml <'))).toBeNull();
    (globalThis as { ran?: boolean }).ran = false;
    svgDrawSize(
      bytes(
        '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" onload="globalThis.ran=true"><script>globalThis.ran=true</script></svg>',
      ),
    );
    expect((globalThis as { ran?: boolean }).ran).toBe(false);
  });
});

describe('svgDrawSize with a long file', () => {
  it('reads the size from the start tag of a file larger than the part it parses', () => {
    const body = '<rect width="1" height="1"/>'.repeat(5000);
    const text = `<?xml version="1.0"?><!-- c --><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50">${body}</svg>`;
    const bytes = new TextEncoder().encode(text);
    expect(bytes.length).toBeGreaterThan(64 * 1024);
    expect(svgDrawSize(bytes)).toEqual({ width: 1024, height: 512 });
  });
  it('is not confused by a greater-than sign inside an attribute', () => {
    const text = '<svg xmlns="http://www.w3.org/2000/svg" data-x="a>b" width="30" height="20">';
    expect(svgDrawSize(new TextEncoder().encode(text))).toEqual({ width: 30, height: 20 });
  });
});

describe('svgBudget', () => {
  it('keeps a small drawing and shrinks a large one with the same shape', () => {
    expect(svgBudget(2048, 2048)).toEqual({ width: 2048, height: 2048 });
    const large = svgBudget(8192, 4096);
    expect(large.width * large.height).toBeLessThanOrEqual(MAX_SVG_PIXELS);
    expect(large.width / large.height).toBeCloseTo(2, 1);
    expect(svgBudget(16384, 1)).toEqual({ width: 16384, height: 1 });
  });
});

describe('imageFits', () => {
  it('allows 16,777,216 pixels and 16,384 on a side, and nothing more', () => {
    expect(imageFits(4096, 4096)).toBe(true);
    expect(imageFits(4097, 4096)).toBe(false);
    expect(imageFits(16384, 1)).toBe(true);
    expect(imageFits(16385, 1)).toBe(false);
    expect(imageFits(0, 10)).toBe(false);
  });
});
