// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDock } from '../../file-viewer/dock';
import { FEEDBACK_HOST_ID, createFeedbackPane, type FeedbackPane } from './feedbackPane';

const URL_ONE = 'https://school.instructure.com/api/v1/canvadoc_session?blob=a&hmac=b';
const URL_TWO = 'https://school.instructure.com/api/v1/canvadoc_session?blob=c&hmac=d';

let pane: FeedbackPane;
const saveWidth = vi.fn<(width: number) => void>();

beforeEach(() => {
  document.documentElement.removeAttribute('style');
  document.body.innerHTML = '';
  const write = process.stderr.write.bind(process.stderr) as (chunk: unknown) => boolean;
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) =>
    String(chunk).includes('Iframe page loading is disabled') ? true : write(chunk),
  );
  pane = createFeedbackPane({ doc: document, theme: () => 'light', width: () => 480, saveWidth });
});
afterEach(() => pane.close());

const host = () => document.getElementById(FEEDBACK_HOST_ID);

describe('the feedback pane', () => {
  it('opens a frame of the session in its own host, and makes room beside it', () => {
    pane.open({ title: 'essay.pdf', url: URL_ONE });
    expect(pane.isOpen).toBe(true);
    expect(host()).not.toBeNull();
    expect(host()?.getAttribute('data-theme')).toBe('light');
    expect(document.documentElement.style.paddingRight).toBe('480px');
    // The root is closed, so the page cannot reach the frame or the address.
    expect(host()?.shadowRoot).toBeNull();
    expect(document.documentElement.outerHTML).not.toContain('canvadoc_session');
  });

  it('shows another session in the same frame', () => {
    pane.open({ title: 'one.pdf', url: URL_ONE });
    pane.open({ title: 'two.pdf', url: URL_TWO });
    expect(document.querySelectorAll(`#${FEEDBACK_HOST_ID}`)).toHaveLength(1);
  });

  it('closes, takes its host away and gives the room back exactly', () => {
    document.documentElement.style.paddingRight = '13px';
    pane.open({ title: 'essay.pdf', url: URL_ONE });
    pane.close();
    expect(pane.isOpen).toBe(false);
    expect(host()).toBeNull();
    expect(document.documentElement.style.paddingRight).toBe('13px');
  });

  it('closes when a page script removes its host', async () => {
    pane.open({ title: 'essay.pdf', url: URL_ONE });
    host()!.remove();
    await Promise.resolve();
    expect(pane.isOpen).toBe(false);
  });

  it('steps aside for the file pane and shows again when it closes', () => {
    pane.open({ title: 'essay.pdf', url: URL_ONE });
    const file = createDock({
      role: 'file',
      id: 'tools-file-viewer',
      label: 'Files',
      resizeLabel: 'Resize',
      width: 480,
      onResized: () => undefined,
    });
    file.open();
    expect(host()?.style.display).toBe('none');
    file.close();
    expect(host()?.style.display).toBe('');
  });

  it('puts a file pane that was open back when it closes', () => {
    const file = createDock({
      role: 'file',
      id: 'tools-file-viewer',
      label: 'Files',
      resizeLabel: 'Resize',
      width: 480,
      onResized: () => undefined,
    });
    file.open();
    pane.open({ title: 'essay.pdf', url: URL_ONE });
    expect(file.shown).toBe(false);
    pane.close();
    expect(file.shown).toBe(true);
    file.close();
  });
});
