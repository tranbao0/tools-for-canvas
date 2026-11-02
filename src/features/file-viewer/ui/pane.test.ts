import { describe, expect, it } from 'vitest';
import { fileKind, formatSize, typeLabel } from './fileInfo';
import { fileLinks } from './links';
import { tabKeyTarget } from './tabKeys';

describe('tab keys', () => {
  it('moves with the arrows and wraps around', () => {
    expect(tabKeyTarget('ArrowRight', 0, 3)).toBe(1);
    expect(tabKeyTarget('ArrowRight', 2, 3)).toBe(0);
    expect(tabKeyTarget('ArrowLeft', 1, 3)).toBe(0);
    expect(tabKeyTarget('ArrowLeft', 0, 3)).toBe(2);
  });
  it('goes to the first and the last tab with Home and End', () => {
    expect(tabKeyTarget('Home', 2, 3)).toBe(0);
    expect(tabKeyTarget('End', 0, 3)).toBe(2);
  });
  it('keeps a single tab in place', () => {
    expect(tabKeyTarget('ArrowRight', 0, 1)).toBe(0);
    expect(tabKeyTarget('ArrowLeft', 0, 1)).toBe(0);
  });
  it('ignores other keys and an empty list', () => {
    expect(tabKeyTarget('Enter', 0, 3)).toBeNull();
    expect(tabKeyTarget('ArrowDown', 0, 3)).toBeNull();
    expect(tabKeyTarget('ArrowRight', 0, 0)).toBeNull();
  });
});

describe('file size', () => {
  it.each([
    [271512, '265 KB'],
    [0, '0 B'],
    [999, '999 B'],
    [1023, '1023 B'],
    [1024, '1 KB'],
    [1536, '1.5 KB'],
    [10240, '10 KB'],
    [1048575, '1 MB'],
    [2500000, '2.4 MB'],
    [104857600, '100 MB'],
    [5 * 1024 ** 3, '5 GB'],
  ])('%d bytes is %s', (bytes, text) => expect(formatSize(bytes)).toBe(text));
  it('gives nothing for a size that is not a number', () => {
    expect(formatSize(Number.NaN)).toBe('');
    expect(formatSize(-1)).toBe('');
  });
});

describe('file type', () => {
  it('names the type of common files', () => {
    expect(typeLabel('application/pdf', 'notes.pdf')).toBe('PDF');
    expect(typeLabel('image/png', 'a.png')).toBe('Image');
    expect(typeLabel('video/mp4', 'a.mp4')).toBe('Video');
    expect(typeLabel('text/plain', 'a.txt')).toBe('Text');
    expect(typeLabel('application/zip', 'bundle.zip')).toBe('ZIP');
    expect(typeLabel('application/octet-stream', 'noextension')).toBe('File');
    expect(
      typeLabel(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'a.docx',
      ),
    ).toBe('Word document');
  });
  it('picks the icon from the name when the content type says nothing', () => {
    expect(fileKind('application/octet-stream', 'deck.PPTX')).toBe('powerpoint');
    expect(fileKind('application/octet-stream', 'grades.xlsx')).toBe('excel');
    expect(fileKind('', 'notes.pdf')).toBe('pdf');
    expect(fileKind('audio/mpeg', 'a.mp3')).toBe('audio');
  });
});

describe('file links', () => {
  const origin = 'https://school.instructure.com';
  it('links to the course file page and to the download', () => {
    expect(fileLinks(origin, '42', '101', '/files/42/download?download_frd=1')).toEqual({
      download: `${origin}/files/42/download?download_frd=1`,
      canvas: `${origin}/courses/101/files/42`,
    });
  });
  it('uses the plain file path without a course', () => {
    expect(fileLinks(origin, '42', null, undefined)).toEqual({
      download: `${origin}/files/42/download`,
      canvas: `${origin}/files/42`,
    });
  });
  it('keeps an absolute address on the same Canvas', () => {
    expect(fileLinks(origin, '42', null, `${origin}/files/42/download?verifier=x`)?.download).toBe(
      `${origin}/files/42/download?verifier=x`,
    );
  });
  it('replaces an empty address', () => {
    expect(fileLinks(origin, '42', null, '')?.download).toBe(`${origin}/files/42/download`);
  });
  it('replaces an address on another host', () => {
    for (const url of ['https://evil.example/x', '//evil.example/x', 'javascript:alert(1)']) {
      expect(fileLinks(origin, '42', null, url)?.download).toBe(`${origin}/files/42/download`);
    }
  });
  it('leaves out a course that is not an id, and rejects a file that is not an id', () => {
    expect(fileLinks(origin, '42', '../1', undefined)?.canvas).toBe(`${origin}/files/42`);
    expect(fileLinks(origin, '../42', null, undefined)).toBeNull();
  });
});
