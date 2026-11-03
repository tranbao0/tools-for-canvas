// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDock } from '../../file-viewer/dock';
import { createTurnInPane, TURN_IN_HOST_ID, TURN_IN_POLL_MS } from './turnInPane';

const ORIGIN = 'https://school.instructure.com';

const panes: { stop(): void }[] = [];
const docks: { close(): void }[] = [];

function setup() {
  const reload = vi.fn<(assignmentId: string) => Promise<void>>(async () => undefined);
  const saveWidth = vi.fn();
  const pane = createTurnInPane({
    doc: document,
    origin: ORIGIN,
    courseId: '12',
    theme: () => 'light',
    width: () => 480,
    saveWidth,
    reload,
  });
  panes.push(pane);
  return { pane, reload, saveWidth };
}

const host = () => document.getElementById(TURN_IN_HOST_ID);

let visibility: DocumentVisibilityState = 'visible';

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  document.documentElement.removeAttribute('style');
  document.body.innerHTML = '';
  // happy-dom writes a line to stderr for each iframe that it does not load. The pane needs no load.
  const write = process.stderr.write.bind(process.stderr) as (chunk: unknown) => boolean;
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) =>
    String(chunk).includes('Iframe page loading is disabled') ? true : write(chunk),
  );
});
afterEach(() => {
  for (const pane of panes.splice(0)) pane.stop();
  for (const dock of docks.splice(0)) dock.close();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function fileDock() {
  const file = createDock({
    role: 'file',
    id: 'tools-file-viewer',
    label: 'File viewer',
    resizeLabel: 'Resize file viewer',
    width: 600,
    onResized: () => undefined,
  });
  docks.push(file);
  return file;
}

describe('the turn-in pane', () => {
  it('opens a docked host with the padding of the page, and a close removes both', () => {
    document.documentElement.style.setProperty('padding-right', '13px');
    const { pane } = setup();
    pane.open({ assignmentId: '101', title: 'Essay' });
    expect(host()).not.toBeNull();
    expect(host()?.hasAttribute('data-av-own')).toBe(true);
    expect(document.documentElement.style.getPropertyValue('padding-right')).toBe('480px');
    pane.reset();
    expect(host()).toBeNull();
    expect(document.documentElement.style.getPropertyValue('padding-right')).toBe('13px');
  });

  it('opens nothing for an assignment id that is not valid', () => {
    const { pane } = setup();
    pane.open({ assignmentId: '../x', title: 'Evil' });
    expect(host()).toBeNull();
    expect(pane.isOpen).toBe(false);
  });

  it('keeps the open frame when Submit is pressed again', () => {
    const { pane } = setup();
    pane.open({ assignmentId: '101', title: 'Essay' });
    const first = document.getElementById(TURN_IN_HOST_ID);
    pane.open({ assignmentId: '102', title: 'Reading' });
    expect(document.getElementById(TURN_IN_HOST_ID)).toBe(first);
    expect(pane.isOpen).toBe(true);
  });

  it('reads the details every 20 seconds while the page is in view', async () => {
    const { pane, reload } = setup();
    pane.open({ assignmentId: '101', title: 'Essay' });
    await vi.advanceTimersByTimeAsync(TURN_IN_POLL_MS - 1);
    expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(reload).toHaveBeenCalledExactlyOnceWith('101');
    visibility = 'hidden';
    await vi.advanceTimersByTimeAsync(TURN_IN_POLL_MS * 3);
    expect(reload).toHaveBeenCalledTimes(1);
    visibility = 'visible';
    await vi.advanceTimersByTimeAsync(TURN_IN_POLL_MS);
    expect(reload).toHaveBeenCalledTimes(2);
    pane.reset();
    await vi.advanceTimersByTimeAsync(TURN_IN_POLL_MS * 3);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('reads nothing on a student switch', () => {
    const { pane, reload } = setup();
    pane.open({ assignmentId: '101', title: 'Essay' });
    pane.reset();
    expect(host()).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it('is only hidden, never removed, while a file pane covers it', () => {
    const { pane } = setup();
    pane.open({ assignmentId: '101', title: 'Essay' });
    const turnIn = host()!;
    const file = fileDock();
    file.open();
    expect(host()).toBe(turnIn);
    expect(turnIn.style.display).toBe('none');
    expect(document.documentElement.style.getPropertyValue('padding-right')).toBe('600px');
    file.close();
    expect(host()).toBe(turnIn);
    expect(turnIn.style.display).toBe('');
    expect(document.documentElement.style.getPropertyValue('padding-right')).toBe('480px');
    pane.reset();
    expect(document.documentElement.style.getPropertyValue('padding-right')).toBe('');
  });

  it('gives the page its own padding back whatever the close order is', () => {
    document.documentElement.style.setProperty('padding-right', '13px', 'important');
    const { pane } = setup();
    const file = fileDock();
    pane.open({ assignmentId: '101', title: 'Essay' });
    file.open();
    pane.reset();
    expect(document.documentElement.style.getPropertyValue('padding-right')).toBe('600px');
    file.close();
    expect(document.documentElement.style.getPropertyValue('padding-right')).toBe('13px');
    expect(document.documentElement.style.getPropertyPriority('padding-right')).toBe('important');
  });

  it('shows over a file pane that was open, and shows the pane again when it closes', () => {
    const { pane } = setup();
    const file = fileDock();
    file.open();
    pane.open({ assignmentId: '101', title: 'Essay' });
    expect(host()?.style.display).toBe('');
    expect(file.host.style.display).toBe('none');
    pane.reset();
    expect(file.host.style.display).toBe('');
    expect(document.documentElement.style.getPropertyValue('padding-right')).toBe('600px');
    file.close();
  });

  it('closes when a page removes its host: no poll, no room, and the covered file pane returns', async () => {
    document.documentElement.style.setProperty('padding-right', '13px');
    const { pane, reload } = setup();
    const file = fileDock();
    file.open();
    pane.open({ assignmentId: '101', title: 'Essay' });
    host()!.remove();
    await vi.advanceTimersByTimeAsync(0);
    expect(pane.isOpen).toBe(false);
    expect(file.host.style.display).toBe('');
    expect(document.documentElement.style.getPropertyValue('padding-right')).toBe('600px');
    await vi.advanceTimersByTimeAsync(TURN_IN_POLL_MS * 3);
    expect(reload).not.toHaveBeenCalled();
    file.close();
    expect(document.documentElement.style.getPropertyValue('padding-right')).toBe('13px');
    // A new Submit opens a new pane.
    pane.open({ assignmentId: '101', title: 'Essay' });
    expect(host()).not.toBeNull();
  });

  it('gives the padding back when the file host is removed while the turn-in covers it', async () => {
    document.documentElement.style.setProperty('padding-right', '13px');
    const { pane } = setup();
    const file = fileDock();
    file.open();
    pane.open({ assignmentId: '101', title: 'Essay' });
    file.host.remove();
    await vi.advanceTimersByTimeAsync(0);
    pane.reset();
    expect(document.documentElement.style.getPropertyValue('padding-right')).toBe('13px');
    file.close();
    expect(document.documentElement.style.getPropertyValue('padding-right')).toBe('13px');
  });

  it('keeps reading while a file pane covers the turn-in', async () => {
    const { pane, reload } = setup();
    const file = fileDock();
    pane.open({ assignmentId: '101', title: 'Essay' });
    file.open();
    expect(host()?.style.display).toBe('none');
    await vi.advanceTimersByTimeAsync(TURN_IN_POLL_MS);
    expect(reload).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(TURN_IN_POLL_MS);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('waits longer after each failed read, up to 5 minutes, and a good read starts over', async () => {
    const { pane, reload } = setup();
    reload.mockRejectedValue(new Error('down'));
    pane.open({ assignmentId: '101', title: 'Essay' });
    const at = async (ms: number) => {
      await vi.advanceTimersByTimeAsync(ms);
      return reload.mock.calls.length;
    };
    expect(await at(20_000)).toBe(1);
    expect(await at(39_000)).toBe(1);
    expect(await at(1000)).toBe(2);
    expect(await at(79_000)).toBe(2);
    expect(await at(1000)).toBe(3);
    // 160 s, then 300 s, and 300 s again.
    expect(await at(160_000)).toBe(4);
    expect(await at(299_000)).toBe(4);
    expect(await at(1000)).toBe(5);
    expect(await at(300_000)).toBe(6);
    reload.mockResolvedValue(undefined);
    expect(await at(300_000)).toBe(7);
    expect(await at(19_000)).toBe(7);
    expect(await at(1000)).toBe(8);
  });
});
