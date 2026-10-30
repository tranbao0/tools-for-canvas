// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { DataMessage } from '../../weekly-list/data/protocol';
import {
  DEFAULT_TOOLS_SETTINGS,
  type DashboardFixesSettings,
} from '../../../shared/settings/tools';
import { createFixesEngine, removeStaleFixes, type FixesEngine } from './controller';
import { dashboardData, drawDashboard, extra, ORIGIN } from './testing/dashboard';

const ON = DEFAULT_TOOLS_SETTINGS.dashboardFixes;
const OFF: DashboardFixesSettings = {
  courseColors: false,
  announcementsInPlace: false,
  courseWorkExtras: false,
  allCourseGrades: false,
};
const DATA = { ...dashboardData([extra({ key: 'u', title: 'Undated work' })]), userId: '5' };

let send: Mock<(message: DataMessage) => Promise<unknown>>;
let engine: FixesEngine;

const settle = async (ms = 120): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
};
const marks = (): number =>
  document.querySelectorAll('[data-wr-own], [data-wr-cc], [data-wr-grades]').length;

beforeEach(() => {
  vi.useFakeTimers();
  drawDashboard();
  send = vi.fn<(message: DataMessage) => Promise<unknown>>(async () => DATA);
  engine = createFixesEngine({ doc: document, origin: ORIGIN, send });
});
afterEach(() => {
  engine.stop();
  vi.useRealTimers();
  document.head.innerHTML = '';
});

describe('createFixesEngine', () => {
  it('does nothing until it is active and has its switches', async () => {
    engine.setSettings(ON);
    await settle();
    expect(marks()).toBe(0);
    expect(send).not.toHaveBeenCalled();
    engine.setActive(true);
    await settle();
    expect(send).toHaveBeenCalledWith({
      type: 'weekrow:dashboard-data',
      includeGradeVisibility: true,
      readToken: expect.any(String),
    });
    expect(document.querySelector('[data-wr-cc]')).not.toBeNull();
    expect(document.querySelector('[data-wr-extra]')).not.toBeNull();
    expect(document.querySelectorAll('[data-wr-card]').length).toBeGreaterThan(0);
    expect(document.getElementById('wr-dashboard-fixes')?.textContent).toContain(
      '[data-wr-cc="101"]',
    );
  });

  it('reads preferences when the grade widget appears after the first load', async () => {
    document.body.innerHTML = '';
    engine.setSettings(ON);
    engine.setActive(true);
    await settle();
    expect(send).not.toHaveBeenCalledWith({
      type: 'weekrow:dashboard-data',
      includeGradeVisibility: true,
      readToken: expect.any(String),
    });
    drawDashboard();
    await settle();
    expect(send).toHaveBeenCalledWith({
      type: 'weekrow:dashboard-data',
      includeGradeVisibility: true,
      readToken: expect.any(String),
    });
    send.mockClear();
    engine.reload();
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ type: 'weekrow:dashboard-data' });
  });

  it('draws cached fixes while the preference request stays pending', async () => {
    send.mockImplementation(async (message) => {
      if (message.type === 'weekrow:dashboard-data' && message.includeGradeVisibility) {
        return new Promise(() => {});
      }
      return DATA;
    });
    engine.setSettings(ON);
    engine.setActive(true);
    await settle();
    expect(document.querySelector('[data-wr-cc]')).not.toBeNull();
    expect(document.querySelector('[data-wr-extra]')).not.toBeNull();
    expect(document.querySelector('[data-testid="course-107-grade"]')?.textContent).toBe('•••');
    engine.reload();
    await settle();
    expect(
      send.mock.calls.filter(
        ([message]) => message.type === 'weekrow:dashboard-data' && message.includeGradeVisibility,
      ),
    ).toHaveLength(1);
  });

  it('reads preferences again when the widget toggle changes', async () => {
    engine.setSettings(ON);
    engine.setActive(true);
    await settle();
    send.mockClear();
    document
      .querySelector('[data-testid="hide-all-grades-checkbox"]')!
      .setAttribute('data-testid', 'show-all-grades-checkbox');
    await settle();
    expect(send).toHaveBeenCalledWith({
      type: 'weekrow:dashboard-data',
      includeGradeVisibility: true,
      readToken: expect.any(String),
    });
  });

  it('refreshes per-course overrides on a return after ten seconds and on focus', async () => {
    const state = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    engine.setSettings(ON);
    engine.setActive(true);
    await settle();
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    await settle(10_000);
    send.mockResolvedValue({
      ...DATA,
      gradeVisibilities: { 'course-grades-widget': { '107': false } },
    });
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(document.querySelector('[data-testid="course-107-grade"]')?.textContent).toBe('•••');
    send.mockResolvedValue(DATA);
    await settle(5000);
    window.dispatchEvent(new Event('focus'));
    await settle();
    expect(document.querySelector('[data-testid="course-107-grade"]')?.textContent).toBe('95%');
    state.mockRestore();
  });

  it('recovers from a stale server main hide within the retry schedule', async () => {
    send.mockResolvedValue({ ...DATA, showGrades: { 'course-grades-widget': false } });
    document
      .querySelector('[data-testid="hide-all-grades-checkbox"]')
      ?.setAttribute('data-testid', 'show-all-grades-checkbox');
    engine.setSettings(ON);
    engine.setActive(true);
    await settle();
    expect(document.querySelector('[data-testid="course-107-grade"]')?.textContent).toBe('•••');
    document
      .querySelector('[data-testid="show-all-grades-checkbox"]')
      ?.setAttribute('data-testid', 'hide-all-grades-checkbox');
    await settle();
    expect(document.querySelector('[data-testid="course-107-grade"]')?.textContent).toBe('•••');
    send.mockResolvedValue({ ...DATA, showGrades: { 'course-grades-widget': true } });
    await settle(2000);
    expect(document.querySelector('[data-testid="course-107-grade"]')?.textContent).toBe('95%');
  });

  it('stops after three retries and never overlaps reads', async () => {
    let release: (value: unknown) => void = () => undefined;
    send.mockImplementation(async (message) => {
      if (message.type === 'weekrow:dashboard-data' && message.includeGradeVisibility)
        return new Promise((resolve) => {
          release = resolve;
        });
      return DATA;
    });
    engine.setSettings(ON);
    engine.setActive(true);
    await settle();
    const reads = () =>
      send.mock.calls.filter(
        ([m]) => m.type === 'weekrow:dashboard-data' && m.includeGradeVisibility,
      ).length;
    expect(reads()).toBe(1);
    await settle(30000);
    expect(reads()).toBe(1);
    release({ ...DATA, showGrades: { 'course-grades-widget': false } });
    await settle();
    for (const delay of [2000, 5000, 15000]) {
      const before = reads();
      await settle(delay);
      expect(reads()).toBe(before + 1);
      await settle(30000);
      expect(reads()).toBe(before + 1);
      release({ ...DATA, showGrades: { 'course-grades-widget': false } });
      await settle();
    }
    await settle(60000);
    expect(reads()).toBe(4);
  });

  it('keeps a local main hide across a blind moment with a visible server', async () => {
    send.mockResolvedValue({ ...DATA, showGrades: { 'course-grades-widget': true } });
    engine.setSettings(ON);
    engine.setActive(true);
    await settle();
    document
      .querySelector('[data-testid="hide-all-grades-checkbox"]')
      ?.setAttribute('data-testid', 'show-all-grades-checkbox');
    await settle();
    engine.setActive(false);
    engine.setActive(true);
    await settle();
    expect(document.querySelector('[data-testid="course-107-grade"]')?.textContent).toBe('•••');
  });

  it('keeps a local hide through a stale main value until a later read agrees', async () => {
    let server = true;
    send.mockImplementation(async () => ({
      ...DATA,
      showGrades: { 'course-grades-widget': server },
    }));
    engine.setSettings(ON);
    engine.setActive(true);
    await settle();
    const text = () => document.querySelector('[data-testid="course-107-grade"]')?.textContent;
    expect(text()).toBe('95%');
    document
      .querySelector('[data-testid="hide-all-grades-checkbox"]')!
      .setAttribute('data-testid', 'show-all-grades-checkbox');
    await settle();
    expect(text()).toBe('•••');
    const state = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    server = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(text()).toBe('•••');
    server = true;
    await settle(10_000);
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(text()).toBe('•••');
    state.mockRestore();
  });

  it('keeps a native hidden grade through a stale read and a data notice', async () => {
    engine.setSettings(ON);
    engine.setActive(true);
    await settle();
    document.querySelector('[data-testid="course-103-grade"]')!.textContent = '•••';
    await settle();
    expect(
      send.mock.calls.filter(
        ([message]) => message.type === 'weekrow:dashboard-data' && message.includeGradeVisibility,
      ),
    ).toHaveLength(2);
    document.querySelector('[data-testid="course-grade-card-103"]')!.remove();
    await settle();
    expect(document.querySelector('[data-testid="course-103-grade"]')?.textContent).toBe('•••');
    send.mockClear();
    engine.reload();
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-testid="course-103-grade"]')?.textContent).toBe('•••');
  });

  it('asks for the data only when a fix is on', async () => {
    engine.setActive(true);
    engine.setSettings(OFF);
    await settle();
    expect(send).not.toHaveBeenCalled();
    expect(document.getElementById('wr-dashboard-fixes')).toBeNull();
    engine.setSettings({ ...OFF, courseColors: true });
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('draws a fix again after React replaced the nodes, in one batched pass for many changes', async () => {
    engine.setSettings(ON);
    engine.setActive(true);
    await settle();
    drawDashboard();
    drawDashboard();
    drawDashboard();
    expect(document.querySelector('[data-wr-extra]')).toBeNull();
    await settle();
    expect(document.querySelectorAll('[data-wr-extra]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-wr-cc]').length).toBe(6);
  });

  it('ignores the changes that the fixes make themselves', async () => {
    engine.setSettings(ON);
    engine.setActive(true);
    await settle();
    const spy = vi.spyOn(document.body, 'querySelectorAll');
    const before = spy.mock.calls.length;
    await settle(500);
    // No change of the page came, so no pass ran.
    expect(spy.mock.calls.length).toBe(before);
  });

  it('removes a fix that is turned off and keeps the others', async () => {
    engine.setSettings(ON);
    engine.setActive(true);
    await settle();
    engine.setSettings({ ...ON, courseWorkExtras: false });
    await settle();
    expect(document.querySelector('[data-wr-extra]')).toBeNull();
    expect(document.querySelector('[data-wr-cc]')).not.toBeNull();
    engine.setSettings({ ...ON, courseWorkExtras: false, courseColors: false });
    await settle();
    expect(document.querySelector('[data-wr-cc]')).toBeNull();
    expect(document.getElementById('wr-dashboard-fixes')?.textContent).not.toContain(
      '[data-wr-cc="101"]',
    );
  });

  it('puts the page back as Canvas drew it when every fix is off or the engine stops', async () => {
    const before = document.body.innerHTML;
    engine.setSettings(ON);
    engine.setActive(true);
    await settle();
    expect(document.body.innerHTML).not.toBe(before);
    engine.setSettings(OFF);
    await settle();
    expect(document.body.innerHTML).toBe(before);
    expect(document.getElementById('wr-dashboard-fixes')).toBeNull();
    engine.setSettings(ON);
    await settle();
    engine.stop();
    expect(document.body.innerHTML).toBe(before);
    expect(document.getElementById('wr-dashboard-fixes')).toBeNull();
  });

  it('removes everything when it turns inactive, as when the page is no longer the saved Canvas', async () => {
    const before = document.body.innerHTML;
    engine.setSettings(ON);
    engine.setActive(true);
    await settle();
    engine.setActive(false);
    await settle();
    expect(document.body.innerHTML).toBe(before);
  });

  it('keeps working when one fix throws', async () => {
    engine.setSettings(ON);
    engine.setActive(true);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    send.mockResolvedValue({
      origin: ORIGIN,
      ready: true,
      courses: [{ id: '101' }],
      extras: 'bad',
    });
    engine.reload();
    await settle();
    // The data is malformed for several fixes. The engine survives and the page stays intact.
    expect(
      document.querySelector('[data-testid="widget-course-work-combined-widget"]'),
    ).not.toBeNull();
  });

  it('ignores a reply that is not the data, and a reply that arrives after a newer request', async () => {
    send.mockResolvedValueOnce('nonsense');
    engine.setSettings(ON);
    engine.setActive(true);
    await settle();
    expect(document.querySelector('[data-wr-extra]')).toBeNull();
    let release: (value: unknown) => void = () => undefined;
    send.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    engine.reload();
    send.mockResolvedValueOnce(DATA);
    engine.reload();
    await settle();
    expect(document.querySelector('[data-wr-extra]')).not.toBeNull();
    release(dashboardData([]));
    await settle();
    // The older answer, with no work, did not replace the newer one.
    expect(document.querySelector('[data-wr-extra]')).not.toBeNull();
  });

  it('a stopped engine stays stopped', async () => {
    engine.stop();
    engine.setSettings(ON);
    engine.setActive(true);
    await settle();
    expect(marks()).toBe(0);
  });
});

describe('removeStaleFixes', () => {
  it('removes the nodes, the marks and the stylesheet that an earlier copy left', async () => {
    const before = document.body.innerHTML;
    engine.setSettings(ON);
    engine.setActive(true);
    await settle();
    expect(document.body.innerHTML).not.toBe(before);
    // The earlier copy is gone with no chance to clean up: a new copy starts from the page.
    removeStaleFixes(document);
    expect(document.body.innerHTML).toBe(before);
    expect(document.getElementById('wr-dashboard-fixes')).toBeNull();
    expect(document.querySelector('[data-wr-own]')).toBeNull();
  });
});
