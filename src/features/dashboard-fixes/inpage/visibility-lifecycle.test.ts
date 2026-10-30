// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest';
import type { DataMessage } from '../../weekly-list/data/protocol';
import { DEFAULT_TOOLS_SETTINGS } from '../../../shared/settings/tools';
import { createFixesEngine, type FixesEngine } from './controller';
import { dashboardData, drawDashboard, ORIGIN } from './testing/dashboard';

const ON = DEFAULT_TOOLS_SETTINGS.dashboardFixes;
const WIDGET = 'course-grades-widget';
let send: Mock<(message: DataMessage) => Promise<unknown>>;
let engine: FixesEngine;
/** What the server holds for the course grades widget, as course id to visible. */
let stored: Record<string, boolean>;
let student: string;
const settle = async (ms = 120) => {
  await vi.advanceTimersByTimeAsync(ms);
};
const grade = (id: string) =>
  document.querySelector(`[data-testid="course-${id}-grade"]`)?.textContent;
const grade103 = () => grade('103');
const isRead = (message: DataMessage) =>
  message.type === 'weekrow:dashboard-data' && message.includeGradeVisibility === true;
const reads = () => send.mock.calls.filter(([message]) => isRead(message)).length;

beforeEach(() => {
  vi.useFakeTimers();
  drawDashboard();
  stored = {};
  student = '5';
  send = vi.fn(async (message: DataMessage) =>
    isRead(message)
      ? {
          origin: ORIGIN,
          ready: false,
          courses: [],
          extras: [],
          userId: student,
          gradeVisibilities: { [WIDGET]: { ...stored } },
        }
      : { ...dashboardData(), userId: student },
  );
  engine = createFixesEngine({ doc: document, origin: ORIGIN, send });
});
afterEach(() => {
  engine.stop();
  vi.useRealTimers();
  document.head.innerHTML = '';
});

async function hide103AndLeave() {
  engine.setSettings(ON);
  engine.setActive(true);
  await settle();
  document.querySelector('[data-testid="course-103-grade"]')!.textContent = '•••';
  stored = { '103': false };
  await settle();
  document.querySelector('[data-testid="course-grade-card-103"]')!.remove();
  await settle();
  expect(grade103()).toBe('•••');
}

it('A: fallback reply without userId (failed user check) then normal reply', async () => {
  await hide103AndLeave();
  send.mockImplementationOnce(async () => ({
    origin: ORIGIN,
    ready: false,
    courses: [],
    extras: [],
  }));
  engine.reload();
  await settle();
  const before = reads();
  engine.reload();
  await settle();
  expect(reads()).toBe(before);
  expect(grade103()).toBe('•••');
});

it('B: setting off then on', async () => {
  await hide103AndLeave();
  engine.setSettings({ ...ON, allCourseGrades: false });
  await settle();
  engine.setSettings(ON);
  await settle();
  expect(grade103()).toBe('•••');
});

it('C: setActive off then on', async () => {
  await hide103AndLeave();
  engine.setActive(false);
  await settle();
  engine.setActive(true);
  await settle();
  expect(grade103()).toBe('•••');
});

it('D: the same confirmed student keeps the observation, a new student clears it', async () => {
  await hide103AndLeave();
  const before = reads();
  engine.reload();
  await settle();
  expect(reads()).toBe(before);
  expect(grade103()).toBe('•••');
  student = '6';
  stored = {};
  engine.reload();
  await settle();
  expect(reads()).toBe(before + 1);
  expect(grade103()).not.toBe('•••');
});

it('E: the first confirmed student starts one read', async () => {
  engine.setSettings(ON);
  engine.setActive(true);
  await settle();
  expect(reads()).toBe(1);
});

it('F: a read that ends with no result runs again when the data changes', async () => {
  let failing = true;
  send.mockImplementation(async (message: DataMessage) =>
    isRead(message)
      ? {
          origin: ORIGIN,
          ready: false,
          courses: [],
          extras: [],
          userId: '5',
          gradeVisibilities: failing ? null : { [WIDGET]: {} },
        }
      : { ...dashboardData(), userId: '5' },
  );
  engine.setSettings(ON);
  engine.setActive(true);
  await settle();
  expect(reads()).toBe(1);
  expect(grade('107')).toBe('•••');
  failing = false;
  engine.reload();
  await settle();
  expect(reads()).toBe(2);
  expect(grade('107')).toBe('95%');
});
