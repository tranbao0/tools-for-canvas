import { describe, expect, it } from 'vitest';
import { decodeText, MAX_TEXT_BYTES, playerType } from './player';
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
  it('takes the file of a submission download link', () => {
    const href = '/courses/12/assignments/3/submissions/7?download=42';
    expect(fileTarget(href, origin)).toEqual({ fileId: '42' });
    expect(catchesDownload(href, origin, '/courses/12/assignments/3/submissions/7')).toBe(true);
    expect(fileTarget('/courses/12/assignments/3/submissions/7?download=x', origin)).toBeNull();
    expect(fileTarget('/courses/12/assignments/3?download=42', origin)).toBeNull();
  });
  for (const href of [
    '/files/42/download?download_frd=1&verifier=secret',
    '/courses/12/files/42/download?verifier=secret',
  ]) {
    it(`takes only the identity from ${href}`, () => {
      expect(fileTarget(href, origin)).toEqual({ fileId: '42' });
      expect(catchesDownload(href, origin, '/courses/12/assignments/3')).toBe(true);
      expect(catchesDownload(href, origin, '/courses/12/assignments/3/submissions/7')).toBe(true);
      expect(catchesDownload(href, origin, '/courses/12/files')).toBe(false);
      expect(
        catchesDownload(`https://other.example${href}`, origin, '/courses/12/assignments/3'),
      ).toBe(false);
    });
  }
});
