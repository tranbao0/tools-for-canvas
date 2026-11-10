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

/** The first bytes of a PNG file. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** The first bytes of a GIF file. */
const GIF = new Uint8Array([...'GIF89a'].map((char) => char.charCodeAt(0)));

/** Makes `new Image()` load at once, with the size the browser would report. */
function fakeImage(width: number, height: number) {
  const drawn: unknown[] = [];
  const sources: string[] = [];
  vi.stubGlobal('Image', function FakeImage() {
    const image = document.createElement('img');
    Object.defineProperties(image, {
      naturalWidth: { value: width },
      naturalHeight: { value: height },
      src: {
        get: () => sources.at(-1) ?? '',
        set: (value: string) => {
          sources.push(value);
          queueMicrotask(() => image.onload?.(new Event('load')));
        },
      },
    });
    return image;
  });
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

it('shows a GIF in an element that plays it, and frees its URL once it has loaded', async () => {
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:gif');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  const drawn = fakeImage(16, 16);
  const host = { readFile: vi.fn(async () => GIF), loadPdfjs: vi.fn() };
  const view = render(
    <MediaTab
      {...base}
      host={host as unknown as PdfHost}
      name="spin.gif"
      contentType="image/gif"
      active
    />,
  );
  const picture = (await screen.findByRole('img', { name: 'spin.gif' })) as HTMLImageElement;
  expect(picture.tagName).toBe('IMG');
  expect(document.querySelector('canvas')).toBeNull();
  expect(drawn).toHaveLength(0);
  expect((create.mock.calls[0]![0] as Blob).type).toBe('image/gif');
  expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:gif');
  view.unmount();
  expect(revoke).toHaveBeenCalledTimes(1);
});

it('types the blob of a raster image by its first bytes, not by its name or header', async () => {
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:typed');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  fakeImage(8, 8);
  const host = { readFile: vi.fn(async () => PNG), loadPdfjs: vi.fn() };
  render(
    <MediaTab
      {...base}
      host={host as unknown as PdfHost}
      name="really-a-png.svg"
      contentType="image/svg+xml"
      active
    />,
  );
  await screen.findByRole('img', { name: 'really-a-png.svg' });
  expect((create.mock.calls[0]![0] as Blob).type).toBe('image/png');
});

it('gives markup that claims to be a raster image to no element', async () => {
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:markup');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  fakeImage(8, 8);
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
  const host = { readFile: vi.fn(async () => svg), loadPdfjs: vi.fn() };
  render(
    <MediaTab
      {...base}
      host={host as unknown as PdfHost}
      name="fake.png"
      contentType="image/png"
      active
    />,
  );
  expect((await screen.findByRole('alert')).textContent).toContain("Couldn't show this image");
  expect(create).not.toHaveBeenCalled();
  expect(document.querySelector('img,canvas')).toBeNull();
});

it('shows no picture for an image over the pixel limit, and still frees its URL', async () => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:big');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  const drawn = fakeImage(4097, 4096);
  const failed = vi.fn();
  const host = { readFile: vi.fn(async () => PNG), loadPdfjs: vi.fn() };
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
  const host = { readFile: vi.fn(async () => PNG), loadPdfjs: vi.fn() };
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

it('puts the scroll offset of a text file back when its tab shows again', async () => {
  let report = () => {};
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        report = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  canPlay('maybe');
  const host = { readFile: vi.fn(async () => new Uint8Array([104, 105])), loadPdfjs: vi.fn() };
  const text = (active: boolean) => (
    <MediaTab
      {...base}
      host={host as unknown as PdfHost}
      name="n.txt"
      contentType="text/plain"
      active={active}
    />
  );
  const view = render(text(true));
  await waitFor(() => expect(document.querySelector('pre')?.textContent).toBe('hi'));
  const scroller = document.querySelector('.fv-media')!;
  Object.defineProperties(scroller, { clientWidth: { value: 472 }, clientHeight: { value: 655 } });
  report();
  scroller.scrollTop = 300;
  scroller.dispatchEvent(new Event('scroll'));
  view.rerender(text(false));
  // Firefox resets the offset of a hidden scroller and fires no scroll event.
  scroller.scrollTop = 0;
  view.rerender(text(true));
  report();
  expect(scroller.scrollTop).toBe(300);
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

it('draws a large SVG at a smaller size with the same shape', async () => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:svg');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  fakeImage(5000, 2000);
  const host = { readFile: vi.fn(async () => new Uint8Array([1])), loadPdfjs: vi.fn() };
  render(
    <MediaTab
      {...base}
      host={host as unknown as PdfHost}
      name="big.svg"
      contentType="image/svg+xml"
      active
    />,
  );
  const canvas = (await screen.findByRole('img', { name: 'big.svg' })) as HTMLCanvasElement;
  expect(canvas.width * canvas.height).toBeLessThanOrEqual(4_194_304);
  expect(canvas.width / canvas.height).toBeCloseTo(2.5, 1);
});

it('says so, and frees the URL, when the browser cannot draw the image', async () => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:bad');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  fakeImage(10, 10);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () =>
      ({
        drawImage: () => {
          throw new Error('broken');
        },
      }) as never,
  );
  const failed = vi.fn();
  const host = { readFile: vi.fn(async () => new Uint8Array([1])), loadPdfjs: vi.fn() };
  render(
    <MediaTab
      {...base}
      host={host as unknown as PdfHost}
      name="x.svg"
      contentType="image/svg+xml"
      active
      onReadFailed={failed}
    />,
  );
  expect((await screen.findByRole('alert')).textContent).toContain("Couldn't show this image");
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  expect(revoke).toHaveBeenCalledWith('blob:bad');
  expect(failed).not.toHaveBeenCalled();
});

it('frees the picture of a large image while its tab is hidden, and shows it again on show', async () => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:img');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  fakeImage(100, 100);
  const host = { readFile: vi.fn(async () => PNG), loadPdfjs: vi.fn() };
  const small = {
    ...base,
    host: host as unknown as PdfHost,
    name: 'p.png',
    contentType: 'image/png',
  };
  // 100 x 100 pixels take 40,000 bytes, which is over a limit of 1,000 bytes.
  const view = render(<MediaTab {...small} active hiddenLimit={1000} />);
  await screen.findByRole('img', { name: 'p.png' });
  view.rerender(<MediaTab {...small} active={false} hiddenLimit={1000} />);
  await waitFor(() => expect(document.querySelector('img')).toBeNull());
  view.rerender(<MediaTab {...small} active hiddenLimit={1000} />);
  await screen.findByRole('img', { name: 'p.png' });
  expect(host.readFile).toHaveBeenCalledTimes(2);
});

it('keeps the picture of a small image while its tab is hidden', async () => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:img2');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  fakeImage(10, 10);
  const host = { readFile: vi.fn(async () => PNG), loadPdfjs: vi.fn() };
  const small = {
    ...base,
    host: host as unknown as PdfHost,
    name: 's.png',
    contentType: 'image/png',
  };
  const view = render(<MediaTab {...small} active />);
  await screen.findByRole('img', { name: 's.png' });
  view.rerender(<MediaTab {...small} active={false} />);
  view.rerender(<MediaTab {...small} active />);
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(document.querySelector('img')).not.toBeNull();
  expect(host.readFile).toHaveBeenCalledTimes(1);
});

it('restores a text offset after an active tab gets its size', async () => {
  let report = () => {};
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        report = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  const host = { readFile: vi.fn(async () => new Uint8Array([104, 105])), loadPdfjs: vi.fn() };
  const text = (active: boolean) => (
    <MediaTab
      {...base}
      host={host as unknown as PdfHost}
      name="n.txt"
      contentType="text/plain"
      active={active}
    />
  );
  const view = render(text(true));
  await waitFor(() => expect(document.querySelector('pre')).not.toBeNull());
  const scroller = document.querySelector('.fv-media')!;
  let height = 655;
  let top = 800;
  Object.defineProperties(scroller, {
    clientWidth: { get: () => (height ? 472 : 0) },
    clientHeight: { get: () => height },
    scrollTop: {
      get: () => top,
      set: (value: number) => {
        top = height ? value : 0;
      },
    },
  });
  report();
  scroller.dispatchEvent(new Event('scroll'));
  view.rerender(text(false));
  height = 0;
  top = 0;
  view.rerender(text(true));
  report();
  height = 655;
  report();
  expect(top).toBe(800);
});

it('keeps a text offset at the end after the text got shorter, through a hide and a show', async () => {
  let report = () => {};
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        report = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  const host = { readFile: vi.fn(async () => new Uint8Array([104, 105])), loadPdfjs: vi.fn() };
  const text = (active: boolean) => (
    <MediaTab
      {...base}
      host={host as unknown as PdfHost}
      name="n.txt"
      contentType="text/plain"
      active={active}
    />
  );
  const view = render(text(true));
  await waitFor(() => expect(document.querySelector('pre')).not.toBeNull());
  const scroller = document.querySelector('.fv-media')!;
  let height = 655;
  let length = 43682;
  let top = 800;
  Object.defineProperties(scroller, {
    clientWidth: { get: () => (height ? 472 : 0) },
    clientHeight: { get: () => height },
    scrollHeight: { get: () => length },
    scrollTop: {
      get: () => top,
      set: (value: number) => {
        top = height ? Math.min(value, Math.max(0, length - height)) : 0;
      },
    },
  });
  report();
  scroller.dispatchEvent(new Event('scroll'));
  // Full view makes the lines wider, so the text gets shorter, and the student reads its end.
  length = 14595;
  top = length - height;
  scroller.dispatchEvent(new Event('scroll'));
  const end = top;
  view.rerender(text(false));
  height = 0;
  top = 0;
  view.rerender(text(true));
  height = 655;
  report();
  expect(top).toBe(end);
});
