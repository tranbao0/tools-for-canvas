import { describe, expect, it, vi } from 'vitest';
import { FileBytesError } from '../../../shared/canvas/fileBytes';
import { loadCommentFile, sniffContentType } from './commentFile';
import { fileLinks } from './links';

const ORIGIN = 'https://school.instructure.com';
const TAB = '/courses/12/assignments/7/submissions/8?comment_id=9&download=45';
const text = (value: string) => new TextEncoder().encode(value);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe('content type of a comment attachment', () => {
  it('takes the type of the answer', () => {
    expect(sniffContentType('application/pdf; charset=x', text('hello'))).toBe('application/pdf');
    expect(sniffContentType('Text/Plain', text('%PDF-1.7'))).toBe('text/plain');
  });
  it('reads the first bytes when the answer is generic or gives none', () => {
    for (const header of [null, '', 'application/octet-stream']) {
      expect(sniffContentType(header, text('%PDF-1.7'))).toBe('application/pdf');
      expect(sniffContentType(header, PNG)).toBe('image/png');
      expect(sniffContentType(header, text('plain words'))).toBe('application/octet-stream');
    }
  });
});

describe('loading a comment attachment', () => {
  const answer = (body: Uint8Array, headers: Record<string, string>) =>
    vi.fn(async () => new Response(body as BodyInit, { status: 200, headers }));
  const load = (fetchImpl: typeof fetch, confirm = async () => true) =>
    loadCommentFile({
      tabId: TAB,
      name: 'Feedback.pdf',
      origin: ORIGIN,
      confirm,
      fetchImpl,
    });

  it('reads only its submission route, with the name of the link and the type of the answer', async () => {
    const fetchImpl = answer(text('%PDF-1.7 and more bytes'), {
      'content-type': 'application/pdf',
    });
    const file = await load(fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(`${ORIGIN}${TAB}`, expect.any(Object));
    expect(file).toMatchObject({
      name: 'Feedback.pdf',
      contentType: 'application/pdf',
      url: `${ORIGIN}${TAB}`,
    });
    expect(Number.isNaN(file.size)).toBe(true);
  });
  it('uses a generic name when the page gave none', async () => {
    const file = await loadCommentFile({
      tabId: TAB,
      name: undefined,
      origin: ORIGIN,
      confirm: async () => true,
      fetchImpl: answer(PNG, {}),
    });
    expect(file.name).not.toBe('');
    expect(file.contentType).toBe('image/png');
  });
  it('fails without a request when the cookie is not confirmed', async () => {
    const fetchImpl = answer(text('x'), {});
    await expect(load(fetchImpl, async () => false)).rejects.toMatchObject({ kind: 'unconfirmed' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('fails when Canvas refuses the route or answers with a page', async () => {
    await expect(
      load(vi.fn(async () => new Response('no', { status: 403 }))),
    ).rejects.toBeInstanceOf(FileBytesError);
    await expect(
      load(answer(text('<html>'), { 'content-type': 'text/html' })),
    ).rejects.toMatchObject({
      kind: 'not_a_file',
    });
  });
});

describe('links of a comment attachment', () => {
  it('download from the route and have no Canvas page', () => {
    expect(fileLinks(ORIGIN, TAB, '12', `${ORIGIN}/other`)).toEqual({
      download: `${ORIGIN}${TAB}`,
      canvas: null,
    });
  });
});
