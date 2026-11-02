// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, expect, it, vi } from 'vitest';
import { FileBytesError } from '../../../shared/canvas/fileBytes';
import { MediaTab } from './MediaTab';
import type { PdfHost } from './PdfTab';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('frees the image URL when its tab closes', async () => {
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fixture');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  const host = {
    readFile: vi.fn(async () => new Uint8Array([1, 2, 3])),
    loadPdfjs: vi.fn(),
  } as unknown as PdfHost;
  const view = render(
    <MediaTab
      host={host}
      url="https://canvas.example/files/1/download"
      name="photo.svg"
      contentType="image/svg+xml"
      active
      attempt={0}
      onRetry={() => undefined}
      onReadFailed={() => undefined}
    />,
  );
  await screen.findByRole('img', { name: 'photo.svg' });
  expect(create).toHaveBeenCalledOnce();
  expect((create.mock.calls[0]![0] as Blob).type).toBe('image/svg+xml');
  expect(document.querySelector('svg')).toBeNull();
  view.unmount();
  await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:fixture'));
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
