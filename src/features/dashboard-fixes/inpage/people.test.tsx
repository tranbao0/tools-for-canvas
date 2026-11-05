// @vitest-environment happy-dom
import { act } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { announcementsFix } from './announcements';
import { composeAddress, filterOf, peopleFix, peopleKey } from './people';
import {
  COURSES,
  dashboardData,
  drawDashboard,
  drawPeopleWidget,
  fakeContext,
  ORIGIN,
  type FakeContext,
} from './testing/dashboard';
import type { PeoplePageReply, PersonRow } from '../protocol';

const WIDGET = '[data-testid="widget-people-widget"]';

function person(id: string, patch: Partial<PersonRow> = {}): PersonRow {
  return {
    id,
    name: `Person ${id}`,
    avatarUrl: null,
    enrollments: [
      { courseId: '101', courseName: 'BIO 110: Principles of Biology', role: 'teacher' },
    ],
    ...patch,
  };
}

const many = (count: number) =>
  Array.from({ length: count }, (_unused, index) => person(String(index + 1)));

async function flush(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
}

interface Server {
  rows: PersonRow[];
  failPages: boolean;
}

function serve(context: FakeContext, server: Server): void {
  context.answer((message) => {
    const request = message as Record<string, unknown>;
    if (request['type'] !== 'weekrow:people-page') return undefined;
    if (server.failPages) throw new Error('offline');
    const filtered = server.rows.filter(
      (candidate) =>
        (request['courseId'] === null ||
          candidate.enrollments.some((item) => item.courseId === request['courseId'])) &&
        (request['role'] === 'all' ||
          candidate.enrollments.some((item) => item.role === request['role'])),
    );
    const offset = request['offset'] as number;
    const first = request['first'] as number;
    const slice = filtered.slice(offset, offset + first);
    const reply: PeoplePageReply = {
      userId: '7',
      items: slice,
      count: slice.length,
      total: filtered.length,
      hasNext: offset + first < filtered.length,
    };
    return reply;
  });
}

let fix: ReturnType<typeof peopleFix>;
let context: FakeContext;
let server: Server;

function host(): HTMLElement | null {
  return document.querySelector<HTMLElement>(`${WIDGET} [data-wr-list]`);
}
function shadow(selector: string): HTMLElement | null {
  return host()?.shadowRoot?.querySelector<HTMLElement>(selector) ?? null;
}
function shadowAll(selector: string): HTMLElement[] {
  return [...(host()?.shadowRoot?.querySelectorAll<HTMLElement>(selector) ?? [])];
}
function pages(): Record<string, unknown>[] {
  return context.sent.filter(
    (message) => (message as { type: string }).type === 'weekrow:people-page',
  ) as Record<string, unknown>[];
}

/** Lets the requests answer, and runs the passes that the fix asks for, as the engine does. */
async function settle(): Promise<void> {
  for (let round = 0; round < 4; round++) {
    const asked = context.again.mock.calls.length;
    await flush();
    if (context.again.mock.calls.length > asked) fix.apply(context);
  }
}

async function start(rows: PersonRow[] = many(25)): Promise<void> {
  server.rows = rows;
  fix.apply(context);
  await settle();
}

function setFilter(testId: string, value: string): void {
  const input = document.querySelector<HTMLInputElement>(`${WIDGET} [data-testid="${testId}"]`)!;
  input.value = value;
  input.setAttribute('value', value);
}

beforeEach(() => {
  vi.useFakeTimers();
  drawDashboard();
  drawPeopleWidget();
  fix = peopleFix();
  context = fakeContext();
  server = { rows: [], failPages: false };
  serve(context, server);
});
afterEach(() => {
  fix.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('filterOf', () => {
  it('reads the filters as the widget shows them', () => {
    expect(filterOf({ courseLabel: 'All Courses', role: 'all' }, COURSES)).toEqual({
      courseId: null,
      role: 'all',
    });
    expect(filterOf({ courseLabel: 'MATH 221: Calculus II', role: 'ta' }, COURSES)).toEqual({
      courseId: '102',
      role: 'ta',
    });
  });

  it('gives null for a role that is not an English label, or a course that it cannot tell', () => {
    expect(filterOf({ courseLabel: 'All Courses', role: null }, COURSES)).toBeNull();
    expect(filterOf({ courseLabel: 'No such course', role: 'all' }, COURSES)).toBeNull();
    // Two courses with one name cannot be told apart, and no data cannot name a course.
    const twins = [COURSES[0]!, { ...COURSES[1]!, name: COURSES[0]!.name }];
    expect(filterOf({ courseLabel: COURSES[0]!.name, role: 'all' }, twins)).toBeNull();
    expect(filterOf({ courseLabel: COURSES[0]!.name, role: 'all' }, null)).toBeNull();
    // An observer has no student course: the data holds none, and Canvas's list has the people.
    expect(filterOf({ courseLabel: 'All Courses', role: 'all' }, [])).toBeNull();
    expect(filterOf({ courseLabel: 'BIO 110', role: 'all' }, [])).toBeNull();
    expect(filterOf({ courseLabel: 'All Courses', role: 'all' }, null)).toEqual({
      courseId: null,
      role: 'all',
    });
  });

  it('keeps one list for each course and role', () => {
    expect(peopleKey({ courseId: null, role: 'all' })).toBe('|all');
    expect(peopleKey({ courseId: '102', role: 'ta' })).toBe('102|ta');
  });
});

describe('composeAddress', () => {
  it('opens the compose page of Canvas for the person in the first course', () => {
    const url = new URL(
      composeAddress(
        ORIGIN,
        person('7001', {
          name: 'Dr. Maya Okafor & Co',
          enrollments: [
            { courseId: '104', courseName: 'CHEM', role: 'ta' },
            { courseId: '101', courseName: 'BIO', role: 'teacher' },
          ],
        }),
      ),
    );
    expect(url.origin).toBe(ORIGIN);
    expect(url.pathname).toBe('/conversations');
    expect(url.searchParams.get('user_id')).toBe('7001');
    expect(url.searchParams.get('user_name')).toBe('Dr. Maya Okafor & Co');
    expect(url.searchParams.get('context_id')).toBe('course_104');
  });
});

describe('the list replaces the one of Canvas', () => {
  it('loads 10 people, marks the pieces of the widget and hides Canvas list and pager', async () => {
    await start();
    expect(pages()[0]).toEqual({
      type: 'weekrow:people-page',
      courseId: null,
      role: 'all',
      offset: 0,
      first: 10,
    });
    expect(shadowAll('article')).toHaveLength(10);
    expect(shadow('[role=feed]')?.getAttribute('aria-label')).toBe('People');
    const widget = document.querySelector(WIDGET)!;
    expect(widget.hasAttribute('data-wr-people')).toBe(true);
    expect(widget.querySelector('[data-wr-pbar]')).not.toBeNull();
    expect(
      widget
        .querySelector('[data-wr-pfb]')
        ?.contains(widget.querySelector('[data-testid="role-filter-select"]')),
    ).toBe(true);
    // The own list stands in the column of the widget, after the filters and the hidden list.
    expect(host()?.parentElement).toBe(widget.querySelector('[data-wr-pbar]'));
    expect(host()?.parentElement?.firstElementChild).toBe(widget.querySelector('[data-wr-pfb]'));
  });

  it('shows the name, each course and role, and the message link of a person', async () => {
    await start([
      person('7001', {
        name: 'Dr. Maya Okafor',
        enrollments: [
          { courseId: '101', courseName: 'BIO 110', role: 'teacher' },
          { courseId: '104', courseName: 'CHEM 120', role: 'ta' },
        ],
      }),
    ]);
    const article = shadow('article')!;
    expect(article.getAttribute('aria-label')).toBe('Dr. Maya Okafor');
    expect(article.querySelector('.wr-p-name')?.textContent).toBe('Dr. Maya Okafor');
    expect(
      [...article.querySelectorAll('.wr-p-enrollment')].map((node) => node.textContent),
    ).toEqual(['BIO 110Teacher', 'CHEM 120Teaching Assistant']);
    expect(article.querySelector('details, [aria-expanded]')).toBeNull();
    const link = article.querySelector<HTMLAnchorElement>('a.wr-p-message')!;
    expect(link.getAttribute('aria-label')).toBe('Send a message to Dr. Maya Okafor');
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
    expect(new URL(link.href).searchParams.get('context_id')).toBe('course_101');
  });

  it('shows the image of a person, and the initials without one', async () => {
    await start([
      person('1', { name: 'Ana Lopez', avatarUrl: 'https://cdn.example.org/a.png' }),
      person('2', { name: 'Sam Whitaker' }),
      person('3', { name: 'Eve', avatarUrl: 'javascript:alert(1)' }),
    ]);
    const [first, second, third] = shadowAll('.wr-a-avatar');
    expect(first?.querySelector('img')?.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(second?.textContent).toBe('SW');
    expect(third?.querySelector('img')).toBeNull();
  });

  it('shows the empty text of Canvas when no person is left', async () => {
    await start([]);
    expect(shadow('.wr-a-scroll')?.textContent).toContain('No instructors found');
  });

  it('follows the filters of Canvas and keeps a list for each', async () => {
    await start([
      ...many(12),
      person('20', {
        enrollments: [{ courseId: '102', courseName: 'MATH 221', role: 'ta' }],
      }),
    ]);
    expect(shadowAll('article')).toHaveLength(10);

    setFilter('course-filter-select', 'MATH 221: Calculus II');
    setFilter('role-filter-select', 'Teaching Assistant');
    fix.apply(context);
    await settle();
    expect(pages().at(-1)).toMatchObject({ courseId: '102', role: 'ta', offset: 0 });
    expect(shadowAll('article')).toHaveLength(1);

    const asked = pages().length;
    setFilter('course-filter-select', 'All Courses');
    setFilter('role-filter-select', 'All Roles');
    fix.apply(context);
    await settle();
    expect(shadowAll('article')).toHaveLength(10);
    expect(pages()).toHaveLength(asked);
  });

  it('gives Canvas its own list back for a filter that it cannot read, and takes it again', async () => {
    await start();
    setFilter('role-filter-select', 'Alle Rollen');
    fix.apply(context);
    expect(host()).toBeNull();
    const widget = document.querySelector(WIDGET)!;
    expect(widget.getAttributeNames().filter((name) => name.startsWith('data-wr-'))).toEqual([]);

    setFilter('role-filter-select', 'All Roles');
    fix.apply(context);
    await settle();
    expect(shadowAll('article')).toHaveLength(10);
  });
});

describe('the fallback', () => {
  it('leaves Canvas its own list when the data has no course, and marks nothing', async () => {
    context.data = dashboardData([]);
    await start();
    expect(host()).toBeNull();
    expect(pages()).toHaveLength(0);
    const widget = document.querySelector(WIDGET)!;
    expect(widget.getAttributeNames().filter((name) => name.startsWith('data-wr-'))).toEqual([]);
    expect(widget.querySelector('[data-wr-pbar], [data-wr-pfb]')).toBeNull();
  });

  it('leaves Canvas its own list for a course of a child, and takes the list for a course of the student', async () => {
    // A student who also observes: the Course filter can name a course that the session lacks.
    await start();
    setFilter('course-filter-select', 'Grade 5 Science (child)');
    fix.apply(context);
    expect(host()).toBeNull();
    expect(
      document
        .querySelector(WIDGET)!
        .getAttributeNames()
        .filter((name) => name.startsWith('data-wr-')),
    ).toEqual([]);

    setFilter('course-filter-select', 'MATH 221: Calculus II');
    fix.apply(context);
    await settle();
    expect(pages().at(-1)).toMatchObject({ courseId: '102' });
    expect(host()).not.toBeNull();
  });

  it('gives Canvas its own list back when the first page fails', async () => {
    server.failPages = true;
    await start();
    expect(host()).toBeNull();
    const widget = document.querySelector(WIDGET)!;
    expect(widget.getAttributeNames().filter((name) => name.startsWith('data-wr-'))).toEqual([]);
    expect(widget.querySelector('[data-wr-pbar], [data-wr-pfb]')).toBeNull();
  });

  it('brings the list back when a later load of the data finds the page', async () => {
    server.failPages = true;
    await start(many(12));
    expect(host()).toBeNull();

    server.failPages = false;
    fix.reload?.();
    await settle();
    fix.apply(context);
    await settle();
    expect(shadowAll('article')).toHaveLength(10);
  });
});

describe('the fix and the other fixes', () => {
  it('removes only its own marks and nodes', async () => {
    const announcements = announcementsFix();
    const both = fakeContext();
    both.answer((message) => {
      const type = (message as { type: string }).type;
      if (type === 'weekrow:people-page') {
        return { userId: '7', items: many(3), count: 3, total: 3, hasNext: false };
      }
      if (type === 'weekrow:announcement-page') {
        return { userId: '7', items: [], count: 0, total: 0, hasNext: false };
      }
      return undefined;
    });
    both.data = dashboardData();
    context = both;
    announcements.apply(both);
    fix.apply(both);
    await settle();
    expect(document.querySelector('[data-wr-own="ann"]')).not.toBeNull();
    expect(document.querySelector('[data-wr-own="people"]')).not.toBeNull();

    // Each fix removes only what it added.
    announcements.remove();
    expect(document.querySelector('[data-wr-own="ann"]')).toBeNull();
    expect(document.querySelector(WIDGET)?.hasAttribute('data-wr-people')).toBe(true);
    expect(document.querySelectorAll('[data-wr-own="people"]')).toHaveLength(1);

    announcements.apply(both);
    await settle();
    fix.remove();
    expect(document.querySelector('[data-wr-own="people"]')).toBeNull();
    expect(document.querySelector(WIDGET)?.hasAttribute('data-wr-people')).toBe(false);
    expect(document.querySelector('[data-wr-own="ann"]')).not.toBeNull();
    announcements.remove();
  });

  it('leaves no mark on the page when it is removed', async () => {
    await start();
    fix.remove();
    expect(document.querySelectorAll('[data-wr-own]')).toHaveLength(0);
    for (const element of document.querySelectorAll('*')) {
      expect(element.getAttributeNames().filter((name) => name.startsWith('data-wr-'))).toEqual([]);
    }
  });
});
