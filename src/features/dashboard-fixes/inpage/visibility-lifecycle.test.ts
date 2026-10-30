// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest';
import type { DataMessage } from '../../weekly-list/data/protocol';
import { DEFAULT_TOOLS_SETTINGS } from '../../../shared/settings/tools';
import { createFixesEngine, type FixesEngine } from './controller';
import { dashboardData, drawDashboard, ORIGIN } from './testing/dashboard';

const ON = DEFAULT_TOOLS_SETTINGS.dashboardFixes;
const DATA = { ...dashboardData(), userId: '5' };
let send: Mock<(message: DataMessage) => Promise<unknown>>;
let engine: FixesEngine;
const settle = async (ms = 120) => {
  await vi.advanceTimersByTimeAsync(ms);
};
const grade = (id: string) =>
  document.querySelector(`[data-testid="course-${id}-grade"]`)?.textContent;
const grade103 = () => grade('103');

beforeEach(() => {
  vi.useFakeTimers();
  drawDashboard();
  send = vi.fn(async () => DATA);
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
  const reads = send.mock.calls.filter(
    ([message]) => message.type === 'weekrow:dashboard-data' && message.includeGradeVisibility,
  ).length;
  engine.reload();
  await settle();
  expect(
    send.mock.calls.filter(
      ([message]) => message.type === 'weekrow:dashboard-data' && message.includeGradeVisibility,
    ),
  ).toHaveLength(reads);
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
  const reads = () =>
    send.mock.calls.filter(
      ([message]) => message.type === 'weekrow:dashboard-data' && message.includeGradeVisibility,
    ).length;
  const before = reads();
  engine.reload();
  await settle();
  expect(reads()).toBe(before);
  expect(grade103()).toBe('•••');
  send.mockImplementationOnce(async () => ({ ...DATA, userId: '6' }));
  engine.reload();
  await settle();
  expect(reads()).toBe(before + 1);
  expect(grade103()).not.toBe('•••');
});

it('E: the first confirmed student does not force a read', async () => {
  engine.setSettings(ON);
  engine.setActive(true);
  await settle();
  expect(
    send.mock.calls.filter(
      ([message]) => message.type === 'weekrow:dashboard-data' && message.includeGradeVisibility,
    ),
  ).toHaveLength(1);
});

it('F: a read that began before any student was confirmed runs again once one is', async () => {
  const reads = () =>
    send.mock.calls.filter(
      ([message]) => message.type === 'weekrow:dashboard-data' && message.includeGradeVisibility,
    ).length;
  const nothing = { origin: ORIGIN, ready: false, courses: [], extras: [] };
  send.mockImplementation(async (message) =>
    message.type === 'weekrow:dashboard-data' && message.includeGradeVisibility
      ? { ...nothing, gradeVisibilities: reads() > 1 ? {} : null }
      : nothing,
  );
  engine.setSettings(ON);
  engine.setActive(true);
  await settle();
  expect(reads()).toBe(1);
  send.mockImplementation(async (message) =>
    message.type === 'weekrow:dashboard-data' && message.includeGradeVisibility
      ? { ...nothing, gradeVisibilities: {} }
      : DATA,
  );
  engine.reload();
  await settle();
  expect(reads()).toBe(2);
  expect(grade('107')).toBe('95%');
});

it('G: a read that ends empty after the first student is confirmed runs again', async () => {
  const reads = () =>
    send.mock.calls.filter(
      ([message]) => message.type === 'weekrow:dashboard-data' && message.includeGradeVisibility,
    ).length;
  let finishRead!: (reply: unknown) => void;
  let finishData!: (reply: unknown) => void;
  send.mockImplementation(async (message) => {
    if (message.type !== 'weekrow:dashboard-data') return DATA;
    if (!message.includeGradeVisibility) {
      return new Promise((resolve) => {
        finishData = resolve;
      });
    }
    return reads() === 1
      ? new Promise((resolve) => {
          finishRead = resolve;
        })
      : { ...DATA, gradeVisibilities: {} };
  });
  engine.setSettings(ON);
  engine.setActive(true);
  await settle();
  expect(reads()).toBe(1);
  finishData(DATA);
  await settle();
  finishRead({ origin: ORIGIN, ready: false, courses: [], extras: [], gradeVisibilities: null });
  await settle();
  expect(reads()).toBe(2);
  expect(grade('107')).toBe('95%');
});
