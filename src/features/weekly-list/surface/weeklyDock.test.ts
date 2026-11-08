// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COURSES_TAB_ID,
  DASHBOARD_TAB_ID,
  findSelectedDashboardTab,
} from '../../../shared/canvas/widgetDashboard';
import { DEFAULT_TOOLS_SETTINGS, type ToolsSettings } from '../../../shared/settings/tools';
import {
  createDock,
  reportFilePane,
  WEEKLY_HOST_ID,
  WEEKLY_TAB_ID,
  type Dock,
} from '../../file-viewer/dock';
import { DEFAULT_SETTINGS, type Settings, type SurfaceState } from '../model/types';
import type { Actions } from '../ui/contract';
import { hideOnCoursesTab } from './coursesTab';
import type { InPlaceSettings, SurfaceRuntime } from './runtime';
import {
  mountWeeklyDock,
  openWork,
  tabText,
  type WeeklyDock,
  type WeeklyDockOptions,
} from './weeklyDock';

// The weekly dock needs 768 px beside it; panes reserve 420 px besides global navigation. These tests use a wide window.
window.innerWidth = 1600;

const html = document.documentElement;
const padding = (): string => html.style.getPropertyValue('padding-right');

/**
 * A state with a week view that has the given number of items in each day group. The rings count
 * `openCount` items as open, whatever the groups show.
 */
function ready(
  days: { kind: 'today' | 'tomorrow' | 'day'; open: number }[],
  openCount = 0,
  older = 0,
) {
  return {
    kind: 'ready',
    view: {
      openCount,
      span: { kind: 'week', days: 7 },
      spanStart: '2026-11-04',
      spanEnd: '2026-11-10',
      groups: [
        { kind: 'past_due', items: [{}, {}, {}], older: [], doneUndated: [] },
        ...days.map(({ kind, open }, index) => ({
          kind,
          items: Array.from({ length: open }, () => ({})),
          older: index === 0 ? Array.from({ length: older }, () => ({})) : [],
          doneUndated: [],
        })),
        { kind: 'no_due_date', items: [{}, {}], older: [], doneUndated: [] },
        { kind: 'done', items: [{}, {}, {}, {}], older: [], doneUndated: [] },
      ],
    },
  } as unknown as SurfaceState;
}

describe('the tab text', () => {
  it('counts the open work that the rings count in the shown span', () => {
    // The rings count 4 items in the span and 2 are done. The day groups hold other rows too, such
    // as reminders and look-ahead items, which the rings leave out.
    const state = ready(
      [
        { kind: 'today', open: 3 },
        { kind: 'tomorrow', open: 2 },
        { kind: 'day', open: 1 },
      ],
      2,
      1,
    );
    expect(openWork(state)).toBe(2);
  });

  it('names the span and the open work in the label', () => {
    const text = tabText(
      ready(
        [
          { kind: 'today', open: 1 },
          { kind: 'day', open: 1 },
        ],
        2,
      ),
    );
    expect(text.span).toBe('Nov 4 - 10');
    expect(text.open).toBe(2);
    expect(text.label).toBe('Open weekly list, Nov 4 - 10, 2 open');
  });

  it('shows the count zero when the span has no open work', () => {
    const text = tabText(ready([{ kind: 'today', open: 0 }]));
    expect(text.open).toBe(0);
    expect(text.label).toBe('Open weekly list, Nov 4 - 10, 0 open');
  });

  it('names only the list before the data is there', () => {
    const text = tabText({ kind: 'loading', undo: null } as unknown as SurfaceState);
    expect(text).toEqual({ span: 'Weekly list', open: null, label: 'Open weekly list' });
    expect(openWork({ kind: 'loading' } as unknown as SurfaceState)).toBeNull();
  });
});

describe('the selected tab of the widget dashboard', () => {
  /** The markup that InstUI Tabs draws: only the selected tab has aria-selected. */
  function tabs(selected: string | null): void {
    const tab = (id: string, label: string): string =>
      `<div role="tab" id="tab-${id}"${selected === id ? ' aria-selected="true"' : ''}><span data-testid="tab-${id}">${label}</span></div>`;
    document.body.innerHTML = `<div data-testid="dashboard-tabs"><div role="tablist">${tab(DASHBOARD_TAB_ID, 'Dashboard')}${tab(COURSES_TAB_ID, 'Courses')}</div></div>`;
  }

  it('finds the Dashboard tab and the Courses tab', () => {
    tabs(DASHBOARD_TAB_ID);
    expect(findSelectedDashboardTab(document)).toBe('dashboard');
    tabs(COURSES_TAB_ID);
    expect(findSelectedDashboardTab(document)).toBe('courses');
  });

  it('finds nothing before React draws the tabs, or when no tab is selected', () => {
    document.body.innerHTML = '';
    expect(findSelectedDashboardTab(document)).toBeNull();
    tabs(null);
    expect(findSelectedDashboardTab(document)).toBeNull();
  });

  it('ignores a selected element outside the tabs of the dashboard', () => {
    document.body.innerHTML =
      '<div role="tab" aria-selected="true"><span data-testid="tab-courses">Courses</span></div>';
    expect(findSelectedDashboardTab(document)).toBeNull();
  });

  describe('the card on the Courses tab', () => {
    afterEach(() => {
      document.body.innerHTML = '';
    });

    function select(id: string): void {
      for (const tab of document.querySelectorAll('[role="tab"]')) {
        if (tab.id === `tab-${id}`) tab.setAttribute('aria-selected', 'true');
        else tab.removeAttribute('aria-selected');
      }
    }

    it('hides the container on the Courses tab and shows it again on the Dashboard tab', async () => {
      tabs(DASHBOARD_TAB_ID);
      const container = document.createElement('div');
      document.body.append(container);
      const stop = hideOnCoursesTab(document, container);
      expect(container.hidden).toBe(false);
      select(COURSES_TAB_ID);
      await Promise.resolve();
      expect(container.hidden).toBe(true);
      select(DASHBOARD_TAB_ID);
      await Promise.resolve();
      expect(container.hidden).toBe(false);
      stop();
    });

    it('hides the container at once for a page that loads on the Courses tab', () => {
      tabs(COURSES_TAB_ID);
      const container = document.createElement('div');
      document.body.append(container);
      const stop = hideOnCoursesTab(document, container);
      expect(container.hidden).toBe(true);
      stop();
      expect(container.hidden).toBe(false);
    });

    it('hides the container when the tabs are drawn after the card, on the Courses tab', async () => {
      document.body.innerHTML = '';
      const container = document.createElement('div');
      document.body.append(container);
      const stop = hideOnCoursesTab(document, container);
      expect(container.hidden).toBe(false);
      const holder = document.createElement('div');
      document.body.append(holder);
      tabs(COURSES_TAB_ID);
      await Promise.resolve();
      expect(container.hidden).toBe(true);
      stop();
    });

    it('keeps the same container and its content', async () => {
      tabs(DASHBOARD_TAB_ID);
      const container = document.createElement('div');
      container.innerHTML = '<span id="state">open group</span>';
      document.body.append(container);
      const stop = hideOnCoursesTab(document, container);
      select(COURSES_TAB_ID);
      await Promise.resolve();
      select(DASHBOARD_TAB_ID);
      await Promise.resolve();
      expect(document.getElementById('state')?.textContent).toBe('open group');
      stop();
    });
  });
});

// -------------------------------------------------------------------------------------------------
// The swap with the file pane
// -------------------------------------------------------------------------------------------------

interface Rig {
  dock: WeeklyDock;
  /** Ends the context of the copy, as an update of the extension does. */
  invalidate(): void;
  container: HTMLElement;
  /** Changes the minimized state in the settings that the list shows. */
  setMinimized(value: boolean): void;
  saved: Settings[];
  savedWidths: number[];
  setTools(tools: ToolsSettings): void;
}

const docks: Dock[] = [];
const rigs: WeeklyDock[] = [];

function fileDock(width = 600): Dock {
  const made = createDock({
    role: 'file',
    id: 'tools-file-viewer',
    label: 'File viewer',
    resizeLabel: 'Resize file viewer',
    width,
    onResized: () => undefined,
  });
  docks.push(made);
  return made;
}

/** The assignment pane, which is a card dock like the file pane. */
function assignmentDock(width = 480): Dock {
  const made = createDock({
    role: 'turn-in',
    id: 'tools-turn-in',
    label: 'Assignment',
    resizeLabel: 'Resize assignment',
    card: true,
    width,
    onResized: () => undefined,
  });
  docks.push(made);
  return made;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
}

/** Starts the weekly dock with a fake runtime. The stored settings load at once. */
async function rig(
  options: { minimized?: boolean; width?: number; fileViewer?: boolean } = {},
): Promise<Rig> {
  let invalid = false;
  let settings: Settings = { ...DEFAULT_SETTINGS, minimized: options.minimized === true };
  let tools: ToolsSettings = {
    ...DEFAULT_TOOLS_SETTINGS,
    weeklyDockWidth: options.width ?? 360,
    // The first show waits for the file pane script only while this switch is on.
    fileViewer: options.fileViewer === true,
  };
  const subscribers = new Set<(state: SurfaceState) => void>();
  const settingsListeners = new Set<(value: Settings) => void>();
  const toolsListeners = new Set<(value: ToolsSettings) => void>();
  const saved: Settings[] = [];
  const savedWidths: number[] = [];
  const runtime = {
    state: () => ready([{ kind: 'today', open: 2 }], 2),
    settings: (): InPlaceSettings => ({ value: settings, courses: [] }),
    announcements: () => undefined,
    actions: {
      saveSettings(next: Settings) {
        saved.push(next);
        settings = next;
        for (const listener of [...subscribers]) listener(runtime.state());
      },
    } as unknown as Actions,
    subscribe(listener: (state: SurfaceState) => void) {
      subscribers.add(listener);
      return () => {
        subscribers.delete(listener);
      };
    },
    start() {},
    stop() {},
  } satisfies SurfaceRuntime;
  const container = document.createElement('div');
  container.id = 'weekrow-inpage';
  document.body.append(container);
  const config: WeeklyDockOptions = {
    doc: document,
    container,
    runtime,
    settings: {
      getValue: () => Promise.resolve(settings),
      watch(listener) {
        settingsListeners.add(listener);
        return () => settingsListeners.delete(listener);
      },
    },
    tools: {
      getValue: () => Promise.resolve(tools),
      setValue(next) {
        savedWidths.push(next.weeklyDockWidth);
        tools = next;
        return Promise.resolve();
      },
      watch(listener) {
        toolsListeners.add(listener);
        return () => toolsListeners.delete(listener);
      },
    },
    theme: 'light',
    invalid: () => invalid,
    log: () => undefined,
  };
  const dock = mountWeeklyDock(config);
  rigs.push(dock);
  await settle();
  return {
    dock,
    invalidate() {
      invalid = true;
    },
    container,
    saved,
    savedWidths,
    setMinimized(value) {
      settings = { ...settings, minimized: value };
      for (const listener of [...settingsListeners]) listener(settings);
    },
    setTools(next) {
      tools = next;
      for (const listener of [...toolsListeners]) listener(next);
    },
  };
}

const host = (): HTMLElement | null => document.getElementById(WEEKLY_HOST_ID);
const tab = (): HTMLElement | null => document.getElementById(WEEKLY_TAB_ID);
const shown = (element: HTMLElement | null): boolean =>
  element !== null && element.isConnected && element.style.display !== 'none';

beforeEach(() => {
  html.removeAttribute('style');
  html.removeAttribute('data-weekrow-room');
  document.body.innerHTML = '';
  document.body.className = 'with-right-side';
});
afterEach(() => {
  for (const made of rigs.splice(0)) made.stop();
  for (const made of docks.splice(0)) made.close();
  document.body.innerHTML = '';
  document.body.className = '';
});

describe('the weekly dock and its tab', () => {
  it('opens at 360 px, takes the room and holds the list in a light DOM child of the host', async () => {
    html.style.setProperty('padding-right', '13px', 'important');
    const { container } = await rig();
    expect(shown(host())).toBe(true);
    expect(host()?.style.width).toBe('360px');
    expect(padding()).toBe('360px');
    expect(container.parentElement).toBe(host());
    expect(tab()).toBeNull();
  });

  it('follows the stored width, and saves a new width in its own setting', async () => {
    const { savedWidths, setTools } = await rig({ width: 480 });
    expect(host()?.style.width).toBe('480px');
    expect(padding()).toBe('480px');
    setTools({ ...DEFAULT_TOOLS_SETTINGS, weeklyDockWidth: 420 });
    expect(padding()).toBe('420px');
    expect(savedWidths).toEqual([]);
  });

  it('a minimized list opens no dock: it shows the tab and keeps 38 px of room for it', async () => {
    html.style.setProperty('padding-right', '13px');
    await rig({ minimized: true });
    expect(host()).toBeNull();
    expect(shown(tab())).toBe(true);
    expect(padding()).toBe('38px');
  });

  it('gives the room back on a minimize and takes it again on an open from the tab', async () => {
    html.style.setProperty('padding-right', '13px');
    const { setMinimized, saved } = await rig();
    expect(padding()).toBe('360px');
    setMinimized(true);
    expect(shown(host())).toBe(false);
    expect(shown(tab())).toBe(true);
    expect(padding()).toBe('38px');
    expect(saved).toEqual([]);
  });

  it('puts the tab on the right edge, 96 px from the top, in a host with the mark of a dock', async () => {
    await rig({ minimized: true });
    const element = tab()!;
    expect(element.style.cssText).toContain('position: fixed');
    expect(element.style.top).toBe('96px');
    expect(element.style.right).toBe('0px');
    expect(element.hasAttribute('data-weekrow-dock')).toBe(true);
  });
});

describe('one dock at a time with the file pane', () => {
  it('hides the dock and its tab while a file pane is open, with no state lost', async () => {
    html.style.setProperty('padding-right', '13px');
    const { container } = await rig();
    container.dataset['mark'] = 'same list';
    const file = fileDock(600);
    file.open();
    expect(shown(host())).toBe(false);
    expect(padding()).toBe('600px');
    expect(container.dataset['mark']).toBe('same list');
    file.close();
    expect(shown(host())).toBe(true);
    expect(padding()).toBe('360px');
    expect(host()?.style.width).toBe('360px');
    expect(container.parentElement).toBe(host());
  });

  it('weekly open, file open, file close: the padding ends at the page padding when the dock goes', async () => {
    html.style.setProperty('padding-right', '13px', 'important');
    const rigged = await rig();
    const file = fileDock(520);
    file.open();
    expect(padding()).toBe('520px');
    file.close();
    expect(padding()).toBe('360px');
    rigged.dock.stop();
    expect(padding()).toBe('13px');
    expect(html.style.getPropertyPriority('padding-right')).toBe('important');
  });

  it('minimized, file open, file close: the tab hides and comes back, and no room is taken', async () => {
    html.style.setProperty('padding-right', '13px');
    await rig({ minimized: true });
    expect(shown(tab())).toBe(true);
    const file = fileDock(600);
    file.open();
    expect(shown(tab())).toBe(false);
    expect(padding()).toBe('600px');
    file.close();
    expect(shown(tab())).toBe(true);
    expect(host()).toBeNull();
    expect(padding()).toBe('38px');
  });

  it('a page that opens with a file pane already open starts with the dock hidden', async () => {
    html.style.setProperty('padding-right', '13px');
    const file = fileDock(600);
    file.open();
    await rig();
    expect(host()).toBeNull();
    expect(padding()).toBe('600px');
    file.close();
    expect(shown(host())).toBe(true);
    expect(padding()).toBe('360px');
  });

  it('a file pane that comes later, as when the File viewer switch goes on, covers the dock', async () => {
    html.style.setProperty('padding-right', '13px');
    await rig();
    expect(padding()).toBe('360px');
    const file = fileDock(700);
    file.open();
    expect(shown(host())).toBe(false);
    expect(padding()).toBe('700px');
    file.close();
    expect(padding()).toBe('360px');
  });

  it('a file pane open, the list minimized by another tab: the room stays with the file pane', async () => {
    html.style.setProperty('padding-right', '13px');
    const { setMinimized } = await rig();
    const file = fileDock(600);
    file.open();
    setMinimized(true);
    expect(padding()).toBe('600px');
    expect(shown(tab())).toBe(false);
    file.close();
    expect(padding()).toBe('38px');
    expect(shown(tab())).toBe(true);
    expect(shown(host())).toBe(false);
  });

  it('hides the dock and its tab while the assignment pane shows, and brings them back when it closes', async () => {
    html.style.setProperty('padding-right', '13px');
    const { container, setMinimized } = await rig();
    container.dataset['mark'] = 'same list';
    const pane = assignmentDock(500);
    pane.open();
    expect(shown(host())).toBe(false);
    expect(padding()).toBe('512px');
    expect(container.dataset['mark']).toBe('same list');
    pane.close();
    expect(shown(host())).toBe(true);
    expect(padding()).toBe('360px');
    setMinimized(true);
    expect(shown(tab())).toBe(true);
    pane.open();
    expect(shown(tab())).toBe(false);
    expect(padding()).toBe('512px');
    pane.close();
    expect(shown(tab())).toBe(true);
    expect(padding()).toBe('38px');
  });

  it('keeps the dock hidden while the assignment pane hides behind a file pane, and shows it when both are gone', async () => {
    html.style.setProperty('padding-right', '13px');
    await rig();
    const pane = assignmentDock(500);
    pane.open();
    const file = fileDock(600);
    file.open();
    pane.setHidden(true);
    expect(shown(host())).toBe(false);
    file.setHidden(true);
    pane.setHidden(false);
    expect(shown(host())).toBe(false);
    file.close();
    expect(shown(host())).toBe(false);
    pane.close();
    expect(shown(host())).toBe(true);
    expect(padding()).toBe('360px');
  });

  it('a resize of each dock changes only its own room', async () => {
    html.style.setProperty('padding-right', '13px');
    const rigged = await rig();
    rigged.setTools({ ...DEFAULT_TOOLS_SETTINGS, weeklyDockWidth: 420 });
    expect(padding()).toBe('420px');
    const file = fileDock(600);
    file.open();
    file.setWidth(640);
    expect(padding()).toBe('640px');
    rigged.setTools({ ...DEFAULT_TOOLS_SETTINGS, weeklyDockWidth: 440 });
    expect(padding()).toBe('640px');
    file.close();
    expect(padding()).toBe('440px');
    expect(file.width).toBe(640);
  });

  it('the file pane going away without a word (the switch went off) brings the dock back', async () => {
    html.style.setProperty('padding-right', '13px');
    await rig();
    const file = fileDock(600);
    file.open();
    expect(shown(host())).toBe(false);
    // The file script ends and removes its host with no close and no message.
    file.host.remove();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(shown(host())).toBe(true);
    expect(padding()).toBe('360px');
  });

  it('a stop at the end gives the page its own padding after every order', async () => {
    html.style.setProperty('padding-right', '13px');
    const rigged = await rig();
    const file = fileDock(600);
    file.open();
    rigged.dock.stop();
    expect(padding()).toBe('600px');
    file.close();
    expect(padding()).toBe('13px');
    expect(html.hasAttribute('data-weekrow-room')).toBe(false);
  });
});

describe('a page that removes the host of the dock', () => {
  it('shows the same host again with the list inside', async () => {
    const { container } = await rig();
    host()?.remove();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(shown(host())).toBe(true);
    expect(container.parentElement).toBe(host());
    expect(padding()).toBe('360px');
  });
});

describe('a copy whose extension context ended', () => {
  it('does not put the dock back after a newer copy removed it, and does not touch the room of the newer copy', async () => {
    html.style.setProperty('padding-right', '13px');
    const old = await rig();
    expect(padding()).toBe('360px');
    old.invalidate();
    // The newer copy removes the dock of this copy and takes the room itself.
    host()?.remove();
    html.style.setProperty('padding-right', '480px');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host()).toBeNull();
    expect(padding()).toBe('480px');
    // The check of the context ends this copy a few seconds later.
    old.dock.stop();
    expect(padding()).toBe('480px');
    expect(host()).toBeNull();
  });

  it('still removes its own dock and gives the room back when nothing took the page', async () => {
    html.style.setProperty('padding-right', '13px');
    const old = await rig();
    old.invalidate();
    old.dock.stop();
    expect(host()).toBeNull();
    expect(padding()).toBe('13px');
  });
});

describe('the room of the tab', () => {
  it('keeps 38 px for the tab of a minimized list and gives the page padding back with the tab', async () => {
    html.style.setProperty('padding-right', '13px', 'important');
    const { dock, setMinimized } = await rig({ minimized: true });
    expect(padding()).toBe('38px');
    expect(html.style.getPropertyPriority('padding-right')).toBe('important');
    setMinimized(false);
    expect(padding()).toBe('360px');
    setMinimized(true);
    expect(padding()).toBe('38px');
    dock.stop();
    expect(padding()).toBe('13px');
    expect(html.style.getPropertyPriority('padding-right')).toBe('important');
    expect(html.hasAttribute('data-weekrow-room')).toBe(false);
  });

  it('does not change the padding on a narrow window, where the tab covers the page', async () => {
    html.style.setProperty('padding-right', '13px');
    const { innerWidth } = window;
    try {
      window.innerWidth = 880;
      await rig({ minimized: true });
      expect(shown(tab())).toBe(true);
      expect(padding()).toBe('13px');
      window.innerWidth = 1280;
      window.dispatchEvent(new Event('resize'));
      expect(padding()).toBe('38px');
    } finally {
      window.innerWidth = innerWidth;
    }
  });

  it('takes the room back from a file pane whose host a page removed while the list is minimized', async () => {
    html.style.setProperty('padding-right', '13px');
    await rig({ minimized: true });
    const file = fileDock(480);
    file.open();
    expect(shown(tab())).toBe(false);
    expect(padding()).toBe('480px');
    file.host.remove();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(shown(tab())).toBe(true);
    expect(padding()).toBe('38px');
  });

  it('puts the tab and its room back when a page removes the tab host', async () => {
    await rig({ minimized: true });
    tab()?.remove();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(shown(tab())).toBe(true);
    expect(padding()).toBe('38px');
  });
});

describe('a stopped copy', () => {
  it('never writes the padding on a resize, also when it lost its host to a newer copy', async () => {
    html.style.setProperty('padding-right', '13px');
    const old = await rig();
    expect(padding()).toBe('360px');
    old.invalidate();
    host()?.remove();
    html.style.setProperty('padding-right', '480px');
    old.dock.stop();
    window.dispatchEvent(new Event('resize'));
    expect(padding()).toBe('480px');
  });

  it('never writes the padding on a resize after a stop of a minimized copy', async () => {
    html.style.setProperty('padding-right', '13px');
    const old = await rig({ minimized: true });
    old.invalidate();
    tab()?.remove();
    html.style.setProperty('padding-right', '480px');
    old.dock.stop();
    window.dispatchEvent(new Event('resize'));
    expect(padding()).toBe('480px');
  });
});

/** Forgets the report of the file pane script, as a page that was just loaded has none. */
function unreportFilePane(): void {
  const scope = globalThis as unknown as Record<symbol, { fileScriptReported?: boolean }>;
  const state = scope[Symbol.for('tools-for-canvas.dock')];
  if (state !== undefined) state.fileScriptReported = false;
}

describe('the first show with the File viewer switch on', () => {
  /** Every value that the padding of the page took, in order. */
  function recordPadding(): string[] {
    const values: string[] = [];
    new MutationObserver(() => {
      const value = padding();
      if (values[values.length - 1] !== value) values.push(value);
    }).observe(html, { attributes: true, attributeFilter: ['style'] });
    return values;
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    unreportFilePane();
  });

  it('holds the dock until the file pane script has reported, and then shows it', async () => {
    unreportFilePane();
    await rig({ fileViewer: true });
    expect(host()).toBeNull();
    expect(padding()).toBe('');
    reportFilePane();
    expect(shown(host())).toBe(true);
    expect(padding()).toBe('360px');
  });

  it('shows the dock after 200 ms when the file pane script has not reported', async () => {
    unreportFilePane();
    await rig({ fileViewer: true });
    await vi.advanceTimersByTimeAsync(199);
    expect(host()).toBeNull();
    await vi.advanceTimersByTimeAsync(2);
    expect(shown(host())).toBe(true);
    expect(padding()).toBe('360px');
  });

  it('never takes the room of the dock when a file pane opens before the report', async () => {
    unreportFilePane();
    const values = recordPadding();
    html.style.setProperty('padding-right', '13px');
    await rig({ fileViewer: true });
    await vi.advanceTimersByTimeAsync(50);
    const file = fileDock(480);
    file.open();
    reportFilePane();
    await vi.advanceTimersByTimeAsync(300);
    expect(host()).toBeNull();
    expect(padding()).toBe('480px');
    expect(values).not.toContain('360px');
    file.close();
    expect(padding()).toBe('360px');
  });

  it('holds the tab of a minimized list in the same way', async () => {
    unreportFilePane();
    await rig({ fileViewer: true, minimized: true });
    expect(tab()).toBeNull();
    expect(padding()).toBe('');
    reportFilePane();
    expect(shown(tab())).toBe(true);
    expect(padding()).toBe('38px');
  });

  it('does not hold the dock while the File viewer switch is off', async () => {
    unreportFilePane();
    await rig({ fileViewer: false });
    expect(shown(host())).toBe(true);
  });

  it('does not hold the dock when the file pane script reported before', async () => {
    reportFilePane();
    await rig({ fileViewer: true });
    expect(shown(host())).toBe(true);
  });
});
