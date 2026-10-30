// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { DataMessage } from '../../weekly-list/data/protocol';
import {
  DEFAULT_TOOLS_SETTINGS,
  type DashboardFixesSettings,
} from '../../../shared/settings/tools';
import { createFixesEngine, type FixesEngine } from './controller';
import { dashboardData, drawDashboard, ORIGIN } from './testing/dashboard';

/**
 * The rule of the grade copies: a copy shows a grade only when a server read confirms it, and
 * that read began after the last moment the fix could have missed a change.
 */
const WIDGET = 'course-grades-widget';
const ON = DEFAULT_TOOLS_SETTINGS.dashboardFixes;
const ALL_OFF: DashboardFixesSettings = {
  courseColors: false,
  announcementsInPlace: false,
  courseWorkExtras: false,
  allCourseGrades: false,
};
const NOTHING = { origin: ORIGIN, ready: false, courses: [], extras: [] };

let send: Mock<(message: DataMessage) => Promise<unknown>>;
let engine: FixesEngine;
/** What the server holds for the course grades widget: course id to visible. */
let stored: Record<string, boolean>;
/** The student that the data replies and the reads name. */
let student: string | undefined;
/** The student that the next read names. */
let readStudent: string | undefined;
let holdReads: boolean;
let held: Array<() => void>;
let holdData: Promise<void> | null;

const settle = async (ms = 120) => {
  await vi.advanceTimersByTimeAsync(ms);
};
const grade = (id: string) =>
  document.querySelector(`[data-testid="course-${id}-grade"]`)?.textContent;
const isRead = (message: DataMessage) =>
  message.type === 'weekrow:dashboard-data' && message.includeGradeVisibility === true;
const reads = () => send.mock.calls.filter(([message]) => isRead(message)).length;

beforeEach(() => {
  vi.useFakeTimers();
  drawDashboard();
  stored = {};
  student = '5';
  readStudent = '5';
  holdReads = false;
  held = [];
  holdData = null;
  send = vi.fn(async (message: DataMessage) => {
    if (message.type !== 'weekrow:dashboard-data') return undefined;
    if (isRead(message)) {
      const reply = () => ({
        ...NOTHING,
        ...(readStudent === undefined ? {} : { userId: readStudent }),
        gradeVisibilities: { [WIDGET]: { ...stored } },
      });
      if (!holdReads) return reply();
      return new Promise((resolve) => held.push(() => resolve(reply())));
    }
    if (holdData) await holdData;
    return { ...dashboardData(), ...(student === undefined ? {} : { userId: student }) };
  });
  engine = createFixesEngine({ doc: document, origin: ORIGIN, send });
});
afterEach(() => {
  engine.stop();
  vi.useRealTimers();
  document.head.innerHTML = '';
});

/** The pager of Canvas: the card of course `from` becomes the card of course `to`. */
function moveCard(from: string, to: string, text: string): void {
  const card = document.querySelector(`[data-testid="course-grade-card-${from}"]`)!;
  for (const node of [card, ...card.querySelectorAll('[data-testid]')]) {
    node.setAttribute('data-testid', node.getAttribute('data-testid')!.replaceAll(from, to));
  }
  document.querySelector(`[data-testid="course-${to}-grade"]`)!.textContent = text;
}

/** The student hides the grade of course 107 with its eye button while the fix is blind. */
async function hideWhileBlind(hides: boolean): Promise<void> {
  await settle();
  expect(document.querySelector('[data-wr-card]')).toBeNull();
  moveCard('103', '107', '95%');
  await settle();
  if (hides) {
    document.querySelector('[data-testid="course-107-grade"]')!.textContent = '•••';
    stored = { '107': false };
    await settle();
  }
  moveCard('107', '103', '91%');
  await settle();
}

async function release(): Promise<void> {
  holdReads = false;
  for (const finish of held.splice(0)) finish();
  await settle();
}

/** The copy shows dots until a read that began after the blind moment confirms. */
async function expectDotsThenServer(comeBack: () => void, hides: boolean): Promise<void> {
  holdReads = true;
  const before = reads();
  comeBack();
  await settle();
  expect(reads()).toBe(before + 1);
  expect(grade('107')).toBe('•••');
  await release();
  expect(grade('107')).toBe(hides ? '•••' : '95%');
}

async function start(): Promise<void> {
  engine.setSettings(ON);
  engine.setActive(true);
  await settle();
  expect(grade('107')).toBe('95%');
}

describe.each([true, false])('a student who hides 107 while the fix is blind: %s', (hides) => {
  it('the grades switch off and on', async () => {
    await start();
    engine.setSettings({ ...ON, allCourseGrades: false });
    await hideWhileBlind(hides);
    await expectDotsThenServer(() => engine.setSettings(ON), hides);
  });

  it('all switches off and on', async () => {
    await start();
    engine.setSettings(ALL_OFF);
    await hideWhileBlind(hides);
    await expectDotsThenServer(() => engine.setSettings(ON), hides);
  });

  it('setActive off and on', async () => {
    await start();
    engine.setActive(false);
    await hideWhileBlind(hides);
    await expectDotsThenServer(() => engine.setActive(true), hides);
  });
});

it('a switch off and on in one tick still starts a fresh read', async () => {
  await start();
  holdReads = true;
  const before = reads();
  engine.setActive(false);
  engine.setActive(true);
  await settle();
  expect(reads()).toBe(before + 1);
  expect(grade('107')).toBe('•••');
  await release();
  expect(grade('107')).toBe('95%');
});

it('a read that began before the fix came back never counts', async () => {
  holdReads = true;
  engine.setSettings(ON);
  engine.setActive(true);
  await settle();
  expect(reads()).toBe(1);
  engine.setActive(false);
  await settle();
  stored = { '107': false };
  engine.setActive(true);
  await settle();
  expect(reads()).toBe(2);
  // The first read answers now. It began before the fix came back on.
  stored = {};
  held.shift()!();
  await settle();
  expect(grade('107')).toBe('•••');
  stored = { '107': false };
  held.shift()!();
  await settle();
  expect(grade('107')).toBe('•••');
});

describe('before the first data reply', () => {
  it('does not count a read that began before it', async () => {
    let open!: () => void;
    holdData = new Promise((resolve) => (open = resolve));
    engine.setSettings(ON);
    engine.setActive(true);
    await settle();
    // The data is not in, so the pager of Canvas still shows.
    expect(document.querySelector('[data-wr-grades]')).toBeNull();
    moveCard('103', '107', '95%');
    await settle();
    document.querySelector('[data-testid="course-107-grade"]')!.textContent = '•••';
    stored = { '107': false };
    await settle();
    moveCard('107', '103', '91%');
    await settle();
    open();
    await settle();
    expect(grade('107')).toBe('•••');
  });

  it('starts no read until a student is confirmed', async () => {
    student = undefined;
    engine.setSettings(ON);
    engine.setActive(true);
    await settle();
    expect(reads()).toBe(0);
    expect(grade('107')).toBe('•••');
    student = '5';
    engine.reload();
    await settle();
    expect(reads()).toBe(1);
    expect(grade('107')).toBe('95%');
  });
});

describe('the student of a read', () => {
  it('drops a read that names another student', async () => {
    readStudent = '4';
    engine.setSettings(ON);
    engine.setActive(true);
    await settle();
    expect(reads()).toBe(1);
    expect(grade('107')).toBe('•••');
  });

  it('drops a read that names no student', async () => {
    readStudent = undefined;
    engine.setSettings(ON);
    engine.setActive(true);
    await settle();
    expect(reads()).toBe(1);
    expect(grade('107')).toBe('•••');
  });

  it('reads again for a new confirmed student and shows that student only after the read', async () => {
    await start();
    student = '6';
    readStudent = '6';
    stored = { '107': false };
    holdReads = true;
    engine.reload();
    await settle();
    expect(grade('107')).toBe('•••');
    await release();
    expect(grade('107')).toBe('•••');
    stored = {};
    student = '5';
    readStudent = '5';
    engine.reload();
    await settle();
    await release();
    expect(grade('107')).toBe('95%');
  });
});

describe('a result that came after the read gave up', () => {
  const late = { [WIDGET]: { '107': true } };
  const token = () =>
    (
      send.mock.calls.filter(([message]) => isRead(message)).at(-1)![0] as {
        readToken?: string;
      }
    ).readToken;

  async function failedRead(): Promise<void> {
    send.mockImplementation(async (message: DataMessage) => {
      if (message.type !== 'weekrow:dashboard-data') return undefined;
      if (isRead(message)) return { ...NOTHING, userId: '5', gradeVisibilities: null };
      return { ...dashboardData(), userId: '5' };
    });
    engine.setSettings(ON);
    engine.setActive(true);
    await settle();
    expect(reads()).toBe(1);
    expect(grade('107')).toBe('•••');
  }

  function lateReply(readToken: string | undefined): void {
    send.mockImplementation(async (message: DataMessage) => {
      if (message.type !== 'weekrow:dashboard-data' || isRead(message)) return undefined;
      return {
        ...dashboardData(),
        userId: '5',
        gradeVisibilities: late,
        ...(readToken === undefined ? {} : { visibilityToken: readToken }),
      };
    });
  }

  it('is used when it names the read that gave up', async () => {
    await failedRead();
    expect(token()).toEqual(expect.any(String));
    lateReply(token());
    engine.reload();
    await settle();
    expect(grade('107')).toBe('95%');
  });

  it('is ignored with no token, or with the token of another read', async () => {
    await failedRead();
    lateReply(undefined);
    engine.reload();
    await settle();
    expect(grade('107')).toBe('•••');
    lateReply('another');
    engine.reload();
    await settle();
    expect(grade('107')).toBe('•••');
  });

  it('is ignored after a blind moment', async () => {
    await failedRead();
    const old = token();
    holdReads = true;
    send.mockImplementation(async (message: DataMessage) => {
      if (message.type !== 'weekrow:dashboard-data') return undefined;
      if (isRead(message)) return new Promise(() => {});
      return {
        ...dashboardData(),
        userId: '5',
        gradeVisibilities: late,
        visibilityToken: old,
      };
    });
    engine.setActive(false);
    engine.setActive(true);
    await settle();
    expect(grade('107')).toBe('•••');
  });
});
