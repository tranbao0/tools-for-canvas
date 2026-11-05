// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  COURSES_TAB_ID,
  DASHBOARD_TAB_ID,
  findSelectedDashboardTab,
} from '../../../shared/canvas/widgetDashboard';
import { DEFAULT_TOOLS_SETTINGS, type ToolsSettings } from '../../../shared/settings/tools';
import { createDock, WEEKLY_HOST_ID, WEEKLY_TAB_ID, type Dock } from '../../file-viewer/dock';
import { DEFAULT_SETTINGS, type Settings, type SurfaceState } from '../model/types';
import type { Actions } from '../ui/contract';
import { hideOnCoursesTab } from './coursesTab';
import type { InPlaceSettings, SurfaceRuntime } from './runtime';
import {
  dashboardHasDock,
  mountWeeklyDock,
  openWork,
  tabText,
  type WeeklyDock,
  type WeeklyDockOptions,
} from './weeklyDock';

const html = document.documentElement;
const padding = (): string => html.style.getPropertyValue('padding-right');

/** A state with a week view that has the given number of items in each day group. */
function ready(days: { kind: 'today' | 'tomorrow' | 'day'; open: number }[], older = 0) {
  return {
    kind: 'ready',
    view: {
      span: { kind: 'week', days: 7 },
      spanStart: '2026-11-04',
      spanEnd: '2026-11-10',
      groups: [
        { kind: 'past_due', items: [{}, {}, {}], older: [], skipped: [], doneUndated: [] },
        ...days.map(({ kind, open }, index) => ({
          kind,
          items: Array.from({ length: open }, () => ({})),
          older: index === 0 ? Array.from({ length: older }, () => ({})) : [],
          skipped: [],
          doneUndated: [],
        })),
        { kind: 'no_due_date', items: [{}, {}], older: [], skipped: [], doneUndated: [] },
        { kind: 'done', items: [{}, {}, {}, {}], older: [], skipped: [], doneUndated: [] },
      ],
    },
  } as unknown as SurfaceState;
}

describe('the tab text', () => {
  it('counts the open work of the day groups only', () => {
    const state = ready([
      { kind: 'today', open: 1 },
      { kind: 'tomorrow', open: 0 },
      { kind: 'day', open: 1 },
    ]);
    expect(openWork(state)).toBe(2);
  });

  it('names the span and the open work in the label', () => {
    const text = tabText(
      ready([
        { kind: 'today', open: 1 },
        { kind: 'day', open: 1 },
      ]),
    );
    expect(text.span).toBe('Nov 4 - 10');
    expect(text.open).toBe(2);
    expect(text.label).toBe('Open weekly list, Nov 4 - 10, 2 open');
  });

  it('says that nothing is open when the span has no open work', () => {
    const text = tabText(ready([{ kind: 'today', open: 0 }]));
    expect(text.open).toBe(0);
    expect(text.label).toBe('Open weekly list, Nov 4 - 10, nothing open');
  });

  it('names only the list before the data is there', () => {
    const text = tabText({ kind: 'loading', undo: null } as unknown as SurfaceState);
    expect(text).toEqual({ span: 'Weekly list', open: null, label: 'Open weekly list' });
    expect(openWork({ kind: 'loading' } as unknown as SurfaceState)).toBeNull();
  });
});

describe('the pages that get the dock', () => {
  afterEach(() => {
    document.body.className = '';
  });

  it.each([
    ['Card View and Recent Activity', 'with-right-side', null, true],
    ['List View', 'dashboard-is-planner', null, true],
    ['the widget dashboard', '', null, false],
    ['a course home page', 'with-right-side', '101', false],
  ])('%s: %s', (_name, bodyClass, courseId, expected) => {
    document.body.className = bodyClass;
    expect(dashboardHasDock(document, courseId)).toBe(expected);
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

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
}

/** Starts the weekly dock with a fake runtime. The stored settings load at once. */
async function rig(options: { minimized?: boolean; width?: number } = {}): Promise<Rig> {
  let settings: Settings = { ...DEFAULT_SETTINGS, minimized: options.minimized === true };
  let tools: ToolsSettings = {
    ...DEFAULT_TOOLS_SETTINGS,
    weeklyDockWidth: options.width ?? 360,
  };
  const subscribers = new Set<() => void>();
  const settingsListeners = new Set<(value: Settings) => void>();
  const toolsListeners = new Set<(value: ToolsSettings) => void>();
  const saved: Settings[] = [];
  const savedWidths: number[] = [];
  const runtime = {
    state: () => ready([{ kind: 'today', open: 2 }]),
    settings: (): InPlaceSettings => ({ value: settings, courses: [] }),
    announcements: () => undefined,
    actions: {
      saveSettings(next: Settings) {
        saved.push(next);
        settings = next;
        for (const listener of [...subscribers]) listener();
      },
    } as unknown as Actions,
    subscribe(listener: () => void) {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
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
    log: () => undefined,
  };
  const dock = mountWeeklyDock(config);
  rigs.push(dock);
  await settle();
  return {
    dock,
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

  it('a minimized list opens no dock: it shows the tab and takes no room', async () => {
    html.style.setProperty('padding-right', '13px');
    await rig({ minimized: true });
    expect(host()).toBeNull();
    expect(shown(tab())).toBe(true);
    expect(padding()).toBe('13px');
  });

  it('gives the room back on a minimize and takes it again on an open from the tab', async () => {
    html.style.setProperty('padding-right', '13px');
    const { setMinimized, saved } = await rig();
    expect(padding()).toBe('360px');
    setMinimized(true);
    expect(shown(host())).toBe(false);
    expect(shown(tab())).toBe(true);
    expect(padding()).toBe('13px');
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
    expect(padding()).toBe('13px');
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
    expect(padding()).toBe('13px');
    expect(shown(tab())).toBe(true);
    expect(shown(host())).toBe(false);
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
