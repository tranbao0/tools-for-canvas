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
  const noBackground = async (): Promise<Uint8Array> => {
    throw new FileBytesError('not_a_file', 'The background read failed');
  };
  const load = (
    fetchImpl: typeof fetch,
    confirm = async () => true,
    prepare: () => Promise<boolean> = async () => true,
    retry: NonNullable<Parameters<typeof loadCommentFile>[0]['retry']> = noBackground,
  ) =>
    loadCommentFile({
      tabId: TAB,
      name: 'Feedback.pdf',
      origin: ORIGIN,
      prepare,
      confirm,
      fetchImpl,
      retry,
    });

  it('drops the probe when the cookie changes during the read', async () => {
    const fetchImpl = answer(text('%PDF-1.7'), { 'content-type': 'application/pdf' });
    const answers = [true, false];
    const prepare = vi.fn(async () => true);
    await expect(
      load(fetchImpl, async () => answers.shift() ?? false, prepare),
    ).rejects.toMatchObject({ kind: 'unconfirmed' });
    // The check that may confirm a new student runs only once, before the read.
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it('reads nothing when the cookie cannot be confirmed before the read', async () => {
    const fetchImpl = answer(text('%PDF-1.7'), { 'content-type': 'application/pdf' });
    await expect(
      load(
        fetchImpl,
        async () => true,
        async () => false,
      ),
    ).rejects.toMatchObject({
      kind: 'unconfirmed',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
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
  it('reads only the first bytes of a long file', async () => {
    let pulled = 0;
    const long = vi.fn(async () => {
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulled += 1;
          if (pulled > 5000) controller.close();
          else controller.enqueue(text('%PDF-1.7 '));
        },
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'application/pdf' } });
    });
    await load(long);
    // A read of all 5000 chunks, or of a file of megabytes, would pull far more.
    expect(pulled).toBeLessThan(10);
  });
  it('uses a generic name when the page gave none', async () => {
    const file = await loadCommentFile({
      tabId: TAB,
      name: undefined,
      origin: ORIGIN,
      prepare: async () => true,
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

describe('a comment attachment whose pane read gets the sign-in page', () => {
  const signIn = () =>
    vi.fn(
      async () =>
        new Response('Sign in', { status: 200, headers: { 'content-type': 'text/html' } }),
    );

  it('reads the head in the background and takes the checked type it gives', async () => {
    const retry = vi.fn(async (options: { onHeaders?: (headers: Headers) => void }) => {
      options.onHeaders?.(new Headers({ 'content-type': 'application/pdf' }));
      return text('%PDF-1.7');
    });
    const file = await loadCommentFile({
      tabId: TAB,
      name: 'Feedback.pdf',
      origin: ORIGIN,
      prepare: async () => true,
      confirm: async () => true,
      fetchImpl: signIn(),
      retry,
    });
    expect(retry).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledWith(
      expect.objectContaining({ url: `${ORIGIN}${TAB}`, truncateAt: 16 }),
      { commentTab: TAB },
    );
    expect(file.contentType).toBe('application/pdf');
  });

  it('reads the first bytes when the background gives no type', async () => {
    const file = await loadCommentFile({
      tabId: TAB,
      name: 'Feedback.pdf',
      origin: ORIGIN,
      prepare: async () => true,
      confirm: async () => true,
      fetchImpl: signIn(),
      retry: async () => text('%PDF-1.7'),
    });
    expect(file.contentType).toBe('application/pdf');
  });

  it('fails when the background read fails too', async () => {
    await expect(
      loadCommentFile({
        tabId: TAB,
        name: 'Feedback.pdf',
        origin: ORIGIN,
        prepare: async () => true,
        confirm: async () => true,
        fetchImpl: signIn(),
        retry: async () => {
          throw new FileBytesError('not_a_file', 'The background read failed');
        },
      }),
    ).rejects.toMatchObject({ kind: 'not_a_file' });
  });
});

describe('links of a comment attachment', () => {
  it('download from the route and have no Canvas page', () => {
    expect(fileLinks(ORIGIN, TAB, '12')).toEqual({
      download: `${ORIGIN}${TAB}`,
      canvas: null,
    });
  });
});
