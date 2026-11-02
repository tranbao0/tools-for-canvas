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
});
describe('submission attachment paths', () => {
  const origin = 'https://canvas.example';
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
