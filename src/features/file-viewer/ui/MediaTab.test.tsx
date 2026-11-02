// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, expect, it, vi } from 'vitest';
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
