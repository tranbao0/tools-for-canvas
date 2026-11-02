// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  decodeText,
  imageFits,
  MAX_SVG_PIXELS,
  MAX_TEXT_BYTES,
  playerType,
  svgBudget,
  svgDrawSize,
} from './player';
import { catchesDownload, fileTarget } from '../model';

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
  const TABLE =
    '<table class="file-upload-submission-table"><tr><td><a href="HREF" download>f</a></td></tr></table>';
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
  ]) {
    it(`takes only the identity from ${href}`, () => {
      expect(fileTarget(href, origin)).toEqual({ fileId: '42' });
      for (const markup of [TABLE, SIDEBAR]) {
        const link = linkIn(markup, href);
        expect(catchesDownload(link, href, origin, '/courses/12/assignments/3')).toBe(true);
        expect(catchesDownload(link, href, origin, '/courses/12/assignments/3/submissions/7')).toBe(
          true,
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
  it('does not take a comment attachment, with or without a download attribute', () => {
    const href = '/courses/12/assignments/3/submissions/7?comment_id=9&download=42';
    expect(fileTarget(href, origin)).toBeNull();
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
      '<table class="file-upload-submission-table"><tr><td><div class="user_content"><a href="/files/42/download" download>f</a></div></td></tr></table>';
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
