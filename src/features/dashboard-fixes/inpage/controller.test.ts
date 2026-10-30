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
const DATA = dashboardData([extra({ key: 'u', title: 'Undated work' })]);

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
    });
    drawDashboard();
    await settle();
    expect(send).toHaveBeenCalledWith({
      type: 'weekrow:dashboard-data',
      includeGradeVisibility: true,
    });
    send.mockClear();
    engine.reload(false);
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
    engine.reload(false);
    await settle();
    expect(
      send.mock.calls.filter(
        ([message]) => message.type === 'weekrow:dashboard-data' && message.includeGradeVisibility,
      ),
    ).toHaveLength(1);
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
