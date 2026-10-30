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
const grade103 = () => document.querySelector('[data-testid="course-103-grade"]')?.textContent;

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
