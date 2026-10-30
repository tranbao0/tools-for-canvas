// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileCheckMessage } from '../protocol';
import { FileCheckPage } from './FileCheckPage';

afterEach(cleanup);

const ORIGIN = 'https://school.instructure.com';
const UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0';

function setup(origin: string | null = ORIGIN) {
  const sent: FileCheckMessage[] = [];
  const send = vi.fn(async (message: FileCheckMessage): Promise<unknown> => {
    sent.push(message);
    if (message.type === 'weekrow:file-check-scan') {
      return {
        tabId: 3,
        scan: {
          pagePath: '/courses/:id',
          kinds: [],
          fileId: null,
          fileIdKind: null,
          metaCsp: null,
        },
        error: null,
      };
    }
    if (message.type === 'weekrow:file-check-frame') {
      return {
        frame: {
          scheme: 'moz-extension',
          handshake: true,
          loadEvent: true,
          dynamicAddress: false,
          ms: 9,
          error: null,
        },
        head: { path: '/', status: 200, error: null, csp: null, cspReportOnly: null },
      };
    }
    return {};
  });
  const copyText = vi.fn(async (_text: string) => undefined);
  render(
    <FileCheckPage
      origin={origin}
      extensionVersion="0.1.0.5"
      userAgent={UA}
      send={send}
      copyText={copyText}
      now={() => new Date('2026-10-30T12:00:00Z')}
    />,
  );
  return { sent, copyText };
}

describe('FileCheckPage', () => {
  it('runs the check and shows a report that has the environment', async () => {
    const { sent } = setup();
    expect(screen.queryByText('Report')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Run check' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Copy report' })).toHaveProperty('disabled', false),
    );
    const report = document.querySelector('[data-part="report"]')?.textContent ?? '';
    expect(report).toContain('Browser: Firefox 140.0');
    expect(report).toContain('Extension version: 0.1.0.5');
    expect(report).toContain('Canvas host: school.instructure.com');
    expect(report).toContain('Date: 2026-10-30');
    expect(report).toContain('Probe page in an iframe (moz-extension address): loaded');
    expect(sent.map((message) => message.type)).toEqual([
      'weekrow:file-check-scan',
      'weekrow:file-check-frame',
    ]);
  });

  it('uses a pasted file id', async () => {
    const { sent } = setup();
    fireEvent.input(screen.getByLabelText(/File id or file link/), { target: { value: '99' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run check' }));
    await waitFor(() =>
      expect(sent.some((message) => message.type === 'weekrow:file-check-file')).toBe(true),
    );
    expect(sent.find((message) => message.type === 'weekrow:file-check-file')).toEqual({
      type: 'weekrow:file-check-file',
      fileId: '99',
    });
  });

  it('copies the report', async () => {
    const { copyText } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Run check' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Copy report' })).toHaveProperty('disabled', false),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy report' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy());
    expect(copyText.mock.calls[0]?.[0]).toContain('File access check');
  });

  it('asks for a saved Canvas first', () => {
    setup(null);
    expect(screen.getByText(/No Canvas is saved/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Run check' })).toBeNull();
  });
});
