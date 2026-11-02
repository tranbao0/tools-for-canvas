// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, expect, it, vi } from 'vitest';
import { FileBytesError } from '../../../shared/canvas/fileBytes';
import { MediaTab } from './MediaTab';
import type { PdfHost } from './PdfTab';

afterEach(async () => {
  cleanup();
  // Preact runs the cleanup of an effect a moment after the unmount. It must still see the mocks.
  await new Promise((resolve) => setTimeout(resolve, 20));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Makes `new Image()` load at once, with the size the browser would report. */
function fakeImage(width: number, height: number) {
  const drawn: unknown[] = [];
  class FakeImage {
    naturalWidth = width;
    naturalHeight = height;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_value: string) {
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal('Image', FakeImage);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ({ drawImage: (...args: unknown[]) => drawn.push(args) }) as never,
  );
  return drawn;
}

const base = {
  url: 'https://canvas.example/files/1/download',
  attempt: 0,
  onRetry: () => undefined,
  onReadFailed: () => undefined,
};

it('draws an SVG on a canvas and frees its URL as soon as it has loaded', async () => {
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fixture');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  const drawn = fakeImage(300, 200);
  const host = {
    readFile: vi.fn(async () => new Uint8Array([1, 2, 3])),
    loadPdfjs: vi.fn(),
  } as unknown as PdfHost;
  const view = render(
    <MediaTab {...base} host={host} name="photo.svg" contentType="image/svg+xml" active />,
  );
  const canvas = (await screen.findByRole('img', { name: 'photo.svg' })) as HTMLCanvasElement;
  expect(canvas.tagName).toBe('CANVAS');
  expect([canvas.width, canvas.height]).toEqual([300, 200]);
  expect(drawn).toHaveLength(1);
  expect(create).toHaveBeenCalledOnce();
  expect((create.mock.calls[0]![0] as Blob).type).toBe('image/svg+xml');
  // The URL is gone while the tab is still open, and no element holds it.
  expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:fixture');
  expect(document.querySelector('img,svg[src],[src^="blob:"]')).toBeNull();
  view.unmount();
  expect(revoke).toHaveBeenCalledTimes(1);
});

it('shows no picture for an image over the pixel limit, and still frees its URL', async () => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:big');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  const drawn = fakeImage(4097, 4096);
  const failed = vi.fn();
  const host = { readFile: vi.fn(async () => new Uint8Array([1])), loadPdfjs: vi.fn() };
  render(
    <MediaTab
      {...base}
      host={host as unknown as PdfHost}
      name="scan.png"
      contentType="image/png"
      active
      onReadFailed={failed}
    />,
  );
  expect((await screen.findByRole('alert')).textContent).toContain('too large');
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  expect(document.querySelector('canvas')).toBeNull();
  expect(drawn).toHaveLength(0);
  expect(revoke).toHaveBeenCalledWith('blob:big');
  expect(failed).not.toHaveBeenCalled();
});

it('shows no picture for an image over 16,384 pixels on a side', async () => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:wide');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  fakeImage(16385, 1);
  const host = { readFile: vi.fn(async () => new Uint8Array([1])), loadPdfjs: vi.fn() };
  render(
    <MediaTab
      {...base}
      host={host as unknown as PdfHost}
      name="w.png"
      contentType="image/png"
      active
    />,
  );
  expect((await screen.findByRole('alert')).textContent).toContain('too large');
});

it('draws an SVG that reports no size at the size of its view box', async () => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:vb');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  fakeImage(0, 0);
  const svg = new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"/>',
  );
  const host = { readFile: vi.fn(async () => svg), loadPdfjs: vi.fn() };
  render(
    <MediaTab
      {...base}
      host={host as unknown as PdfHost}
      name="v.svg"
      contentType="image/svg+xml"
      active
    />,
  );
  const canvas = (await screen.findByRole('img', { name: 'v.svg' })) as HTMLCanvasElement;
  expect([canvas.width, canvas.height]).toEqual([1024, 512]);
});

it('shows the progress bar of the read, and removes it when the file has loaded', async () => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:p');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  canPlay('maybe');
  let finish: (bytes: Uint8Array) => void = () => undefined;
  const host = {
    readFile: vi.fn((_url: string, onProgress: (loaded: number, total: number | null) => void) => {
      onProgress(0, 200);
      onProgress(50, 200);
      return new Promise<Uint8Array>((resolve) => (finish = resolve));
    }),
    loadPdfjs: vi.fn(),
  };
  render(
    <MediaTab
      {...base}
      host={host as unknown as PdfHost}
      name="a.wav"
      contentType="audio/wav"
      active
    />,
  );
  const bar = await screen.findByRole('progressbar', { name: 'Loading file' });
  expect(bar.getAttribute('aria-valuenow')).toBe('25');
  expect(bar.getAttribute('data-part')).toBe('media-progress');
  finish(new Uint8Array([1]));
  await waitFor(() => expect(document.querySelector('audio')).not.toBeNull());
  expect(screen.queryByRole('progressbar')).toBeNull();
});

it('asks the reader to stop a text file after 2 MB and a few bytes', async () => {
  canPlay('maybe');
  const host = { readFile: vi.fn(async () => new Uint8Array([104, 105])), loadPdfjs: vi.fn() };
  render(
    <MediaTab
      {...base}
      host={host as unknown as PdfHost}
      name="n.txt"
      contentType="text/plain"
      active
    />,
  );
  await waitFor(() => expect(document.querySelector('pre')?.textContent).toBe('hi'));
  const options = (host.readFile.mock.calls[0] as unknown[])[3];
  expect(options).toEqual({ truncateAt: 2 * 1024 * 1024 + 4 });
  // Audio and video read the whole file.
  host.readFile.mockClear();
  cleanup();
  render(
    <MediaTab
      {...base}
      host={host as unknown as PdfHost}
      name="a.wav"
      contentType="audio/wav"
      active
    />,
  );
  await waitFor(() => expect(host.readFile).toHaveBeenCalled());
  expect((host.readFile.mock.calls[0] as unknown[])[3]).toBeUndefined();
});

it('shows an empty text file as a pre element', async () => {
  const host = {
    readFile: vi.fn(async () => new Uint8Array()),
    loadPdfjs: vi.fn(),
  } as unknown as PdfHost;
  render(
    <MediaTab
      host={host}
      url="https://canvas.example/files/1/download"
      name="empty.txt"
      contentType="text/plain"
      active
      attempt={0}
      onRetry={() => undefined}
      onReadFailed={() => undefined}
    />,
  );
  await waitFor(() => expect(document.querySelector('pre')?.textContent).toBe(''));
});

function props(host: unknown, over: Partial<Parameters<typeof MediaTab>[0]> = {}) {
  return {
    host: host as PdfHost,
    url: 'https://canvas.example/files/1/download',
    name: 'clip.webm',
    contentType: 'video/webm',
    active: true,
    attempt: 0,
    onRetry: () => undefined,
    onReadFailed: () => undefined,
    ...over,
  };
}

function canPlay(answer: string) {
  vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue(answer as CanPlayTypeResult);
}

it('pauses a video when its tab is no longer shown', async () => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fixture');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  canPlay('maybe');
  const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  const host = { readFile: vi.fn(async () => new Uint8Array([1])), loadPdfjs: vi.fn() };
  const view = render(<MediaTab {...props(host)} />);
  await waitFor(() => expect(document.querySelector('video')).not.toBeNull());
  pause.mockClear();
  view.rerender(<MediaTab {...props(host, { active: false })} />);
  await waitFor(() => expect(pause).toHaveBeenCalled());
});

it('says so when the browser cannot play the type, and reads nothing', async () => {
  canPlay('');
  const host = { readFile: vi.fn(), loadPdfjs: vi.fn() };
  render(<MediaTab {...props(host)} />);
  expect((await screen.findByRole('alert')).textContent).toContain("can't play");
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  expect(host.readFile).not.toHaveBeenCalled();
});

it('gives no Retry when the bytes are larger than the record said', async () => {
  canPlay('maybe');
  const failed = vi.fn();
  const host = {
    readFile: vi.fn(async () => {
      throw new FileBytesError('too_large', 'The file is too large');
    }),
    loadPdfjs: vi.fn(),
  };
  render(<MediaTab {...props(host, { onReadFailed: failed })} />);
  expect((await screen.findByRole('alert')).textContent).toContain('too large');
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  expect(failed).not.toHaveBeenCalled();
});

it('does not start the access recheck for an unconfirmed sign-in', async () => {
  canPlay('maybe');
  const failed = vi.fn();
  const host = {
    readFile: vi.fn(async () => {
      throw new FileBytesError('unconfirmed', 'No');
    }),
    loadPdfjs: vi.fn(),
  };
  render(<MediaTab {...props(host, { onReadFailed: failed })} />);
  expect((await screen.findByRole('alert')).textContent).toContain("can't confirm");
  expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  expect(failed).not.toHaveBeenCalled();
});

it('does not read a media tab that has not been shown yet', async () => {
  canPlay('maybe');
  const host = { readFile: vi.fn(async () => new Uint8Array([1])), loadPdfjs: vi.fn() };
  render(<MediaTab {...props(host, { active: false })} />);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(host.readFile).not.toHaveBeenCalled();
});

function mediaProps(host: unknown, over: Partial<Parameters<typeof MediaTab>[0]> = {}) {
  return { ...props(host), hiddenLimit: 4, ...over };
}

it('frees a large audio or video file while its tab is hidden, and reads it again on show', async () => {
  let n = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:m${(n += 1)}`);
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  canPlay('maybe');
  const host = { readFile: vi.fn(async () => new Uint8Array(10)), loadPdfjs: vi.fn() };
  const view = render(<MediaTab {...mediaProps(host)} />);
  await waitFor(() => expect(document.querySelector('video')?.getAttribute('src')).toBe('blob:m1'));
  view.rerender(<MediaTab {...mediaProps(host, { active: false })} />);
  await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:m1'));
  await waitFor(() => expect(document.querySelector('video')).toBeNull());
  expect(host.readFile).toHaveBeenCalledTimes(1);
  view.rerender(<MediaTab {...mediaProps(host, { active: true })} />);
  await waitFor(() => expect(document.querySelector('video')?.getAttribute('src')).toBe('blob:m2'));
  expect(host.readFile).toHaveBeenCalledTimes(2);
});

it('keeps a small audio or video file while its tab is hidden', async () => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:small');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  canPlay('maybe');
  const host = { readFile: vi.fn(async () => new Uint8Array(2)), loadPdfjs: vi.fn() };
  const view = render(<MediaTab {...mediaProps(host)} />);
  await waitFor(() => expect(document.querySelector('video')).not.toBeNull());
  view.rerender(<MediaTab {...mediaProps(host, { active: false })} />);
  view.rerender(<MediaTab {...mediaProps(host, { active: true })} />);
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(revoke).not.toHaveBeenCalled();
  expect(host.readFile).toHaveBeenCalledTimes(1);
  expect(document.querySelector('video')?.getAttribute('src')).toBe('blob:small');
});

it('does not keep a large file that finishes loading in a hidden tab', async () => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:late');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  canPlay('maybe');
  let finish: (bytes: Uint8Array) => void = () => undefined;
  const host = {
    readFile: vi.fn(() => new Promise<Uint8Array>((resolve) => (finish = resolve))),
    loadPdfjs: vi.fn(),
  };
  const view = render(<MediaTab {...mediaProps(host)} />);
  await waitFor(() => expect(host.readFile).toHaveBeenCalled());
  view.rerender(<MediaTab {...mediaProps(host, { active: false })} />);
  finish(new Uint8Array(10));
  await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:late'));
  expect(document.querySelector('video')).toBeNull();
});
