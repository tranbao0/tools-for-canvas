/**
 * The widget fixture and a fake context for the unit tests of the fixes. The markup is the one of
 * `tests/fixtures/pages/dashboard-widgets.html`, which follows the widget package.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { vi, type Mock } from 'vitest';
import type { DashboardCourse, DashboardData } from '../../protocol';
import type { FixContext } from '../context';

export const ORIGIN = 'https://school.instructure.com';

const FIXTURE = readFileSync(
  join(process.cwd(), 'tests', 'fixtures', 'pages', 'dashboard-widgets.html'),
  'utf8',
);

/** Puts the content of the widget dashboard into the document, as Canvas draws it. */
export function drawDashboard(doc: Document = document): void {
  const match = /<template data-fixture-step="replace"[^>]*>([\s\S]*)<\/template>/.exec(FIXTURE);
  doc.body.innerHTML = match?.[1] ?? '';
}

const PEOPLE_WIDGET =
  /<template id="fixture-people-widget">([\s\S]*?)<\/template>/.exec(FIXTURE)?.[1] ?? '';

/**
 * Puts the People widget with the markup of the package in place of the plain People block, as
 * the page does with `?fixture_people=1`. Call it after `drawDashboard`.
 */
export function drawPeopleWidget(doc: Document = document): void {
  const slot = doc.querySelector('[data-testid="widget-container-people-widget"]');
  if (slot !== null) slot.innerHTML = PEOPLE_WIDGET;
}

export const COURSES: DashboardCourse[] = [
  course('101', 'BIO 110: Principles of Biology', '#0B874B', 84.4, 'B'),
  course('102', 'MATH 221: Calculus II', '#E71F63', 78.9, null),
  course('103', 'History', '#8F3E97', 91.5, null),
  course('104', 'CHEM 120: General Chemistry', '#FFD500', null, null, '#000000'),
  course('105', 'Student Success Orientation', '#65499D', null, null),
  course('106', 'Intramural Ultimate Frisbee Club', '#FC5E13', null, null),
  course('107', 'PSYC 100: Intro to Psychology', '#324A4D', 95.7, null),
];

function course(
  id: string,
  name: string,
  color: string,
  score: number | null,
  grade: string | null,
  ink = '#FFFFFF',
): DashboardCourse {
  return {
    id,
    name,
    code: name.split(':')[0] ?? name,
    term: 'Fall 2026',
    color,
    ink,
    score,
    grade,
  };
}

export function dashboardData(courses = COURSES): DashboardData {
  return { origin: ORIGIN, courses, gradeVisibilities: {} };
}

export interface FakeContext extends FixContext {
  sent: unknown[];
  blocks: Map<string, string | null>;
  again: Mock<() => void>;
  /** Answers the next message that `send` gets. */
  answer(reply: (message: unknown) => unknown): void;
}

/** A context whose `send` answers from `answer`, and records every message. */
export function fakeContext(data: DashboardData | null = dashboardData()): FakeContext {
  let reply: (message: unknown) => unknown = () => undefined;
  const sent: unknown[] = [];
  const blocks = new Map<string, string | null>();
  return {
    doc: document,
    origin: ORIGIN,
    data,
    sent,
    blocks,
    send: vi.fn(async (message) => {
      sent.push(message);
      return reply(message);
    }),
    css: (name, css) => blocks.set(name, css),
    again: vi.fn<() => void>(),
    answer(next) {
      reply = next;
    },
  };
}
