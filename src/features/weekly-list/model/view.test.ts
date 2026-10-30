import { describe, expect, it } from 'vitest';
import type { Assignment } from '../../../shared/canvas/types';
import { DEFAULT_SETTINGS, type ModelInput, type Span } from './types';
import { buildWeekView, plannerRangeFor } from './view';
import {
  assignment,
  course,
  detailsById,
  findItem,
  modelInput,
  override,
  placeOf,
  placements,
  plannerItem,
  type PlannerItemSpec,
} from './testing/builders';

const TUESDAY_2PM = '2026-10-27T18:00:00Z';
const SATURDAY_2PM = '2026-10-31T18:00:00Z';
const biology = course('101', 'Biology', '2026-08-24T04:00:00Z');

function task(
  id: string,
  date: string,
  extra: Partial<PlannerItemSpec> = {},
): ReturnType<typeof plannerItem> {
  return plannerItem({ type: 'assignment', id, courseId: '101', date, ...extra });
}

function upload(id: string, extra: Partial<Parameters<typeof assignment>[0]> = {}): Assignment {
  return assignment({ id, courseId: '101', types: ['online_upload'], ...extra });
}

function input(partial: Partial<ModelInput> & { now?: string } = {}): ModelInput {
  return modelInput({ now: TUESDAY_2PM, courses: [biology], ...partial });
}

function placesOf(view: ReturnType<typeof buildWeekView>): Record<string, string> {
  return Object.fromEntries(
    [...placements(view)].map(([key, places]) => [key, places.join(' + ')]),
  );
}

describe('plannerRangeFor', () => {
  const range = (partial: Partial<ModelInput> = {}) => plannerRangeFor(input(partial));

  it('starts at the earliest horizon and ends one millisecond before the span ends', () => {
    expect(range()).toEqual({
      start: '2026-08-24T04:00:00.000Z',
      end: '2026-11-03T04:59:59.999Z',
    });
  });

  it('ends at the end of tomorrow when a Day span ends before it, after the daylight saving change', () => {
    expect(
      range({
        now: '2026-10-31T18:00:00Z',
        settings: { ...DEFAULT_SETTINGS, span: { kind: 'day', days: 7 } },
      }).end,
    ).toBe('2026-11-02T04:59:59.999Z');
  });

  it('starts at the viewed span when the span is older than every horizon, and still ends after tomorrow', () => {
    expect(range({ spanOffset: -12 })).toEqual({
      start: '2026-08-04T04:00:00.000Z',
      end: '2026-10-29T03:59:59.999Z',
    });
  });

  it('starts no later than today when every term starts in the future', () => {
    const futureTerm = [course('101', 'Biology', '2026-11-02T05:00:00Z')];
    expect(range({ courses: futureTerm })).toEqual({
      start: '2026-10-27T04:00:00.000Z',
      end: '2026-11-03T04:59:59.999Z',
    });
    expect(range({ courses: futureTerm, spanOffset: 1 }).start).toBe('2026-10-27T04:00:00.000Z');
  });

  it('ignores hidden courses and uses 16 weeks when no course is visible', () => {
    expect(
      range({ spanOffset: 1, settings: { ...DEFAULT_SETTINGS, hiddenCourseIds: ['101'] } }),
    ).toEqual({ start: '2026-07-07T04:00:00.000Z', end: '2026-11-10T04:59:59.999Z' });
  });

  it('has plain UTC instants with no bracketed zone', () => {
    const tokyo = input().profile;
    const result = range({
      browserTimeZone: 'Asia/Tokyo',
      profile: { ...tokyo, time_zone: 'Asia/Tokyo' },
    });
    expect(result.start).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(result.end).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.999Z$/);
  });
});

describe('the Tomorrow look-ahead', () => {
  const day = { ...DEFAULT_SETTINGS, span: { kind: 'day', days: 7 } } as const;

  it('shows tomorrow after a Day span, outside the rings', () => {
    const view = buildWeekView(
      input({
        now: SATURDAY_2PM,
        settings: day,
        plannerItems: [
          task('1', '2026-11-01T15:00:00Z'),
          task('2', '2026-11-01T16:00:00Z', { submissions: { submitted: true } }),
          task('3', '2026-11-02T15:00:00Z'),
          task('4', '2026-10-31T23:00:00Z'),
          task('5', '2026-11-01T17:00:00Z'),
        ],
        assignmentDetails: detailsById([
          upload('1'),
          upload('2'),
          upload('3'),
          upload('4'),
          upload('5', { types: ['none'] }),
        ]),
      }),
    );
    expect(view.spanEnd).toBe('2026-10-31');
    expect(placesOf(view)).toEqual({
      'assignment:4': 'today@2026-10-31.items',
      'assignment:1': 'tomorrow@2026-11-01.items',
      'assignment:5': 'tomorrow@2026-11-01.items',
      'assignment:2': 'done.items',
    });
    expect(findItem(view, 'assignment:1')).toMatchObject({ isLookAhead: true, state: 'open' });
    expect(findItem(view, 'assignment:2')).toMatchObject({ isLookAhead: true, state: 'done' });
    expect(findItem(view, 'assignment:4').isLookAhead).toBe(false);
    expect(view.rings).toEqual([
      expect.objectContaining({ courseId: '101', done: 0, total: 1, pastDue: 0 }),
    ]);
  });

  it('is a normal day inside a Week span', () => {
    const view = buildWeekView(input({ plannerItems: [task('1', '2026-10-28T16:00:00Z')] }));
    expect(findItem(view, 'assignment:1')).toMatchObject({ isLookAhead: false });
    expect(view.rings[0]).toMatchObject({ total: 1 });
  });

  it('is a normal day on the last day of a Week span, where tomorrow is in the next span', () => {
    const view = buildWeekView(
      input({ plannerItems: [task('1', '2026-11-03T16:00:00Z')], spanOffset: 0 }),
    );
    expect(view.spanEnd).toBe('2026-11-02');
    expect(placesOf(view)).toEqual({});
  });
});

describe('the Canvas language', () => {
  const noLanguage = { ...input().profile, locale: null, effective_locale: '' };

  it('sets the clock from effective_locale', () => {
    const arabic = { ...input().profile, effective_locale: 'ar' };
    expect(buildWeekView(input({ profile: arabic })).hourCycle).toBe('h23');
    expect(buildWeekView(input()).hourCycle).toBe('h12');
  });

  it('falls back to the browser language when Canvas sends no language', () => {
    expect(buildWeekView(input({ profile: noLanguage, browserLanguage: 'en-GB' })).hourCycle).toBe(
      'h23',
    );
    expect(buildWeekView(input({ profile: noLanguage })).hourCycle).toBe('h12');
  });

  it('prefers the Canvas language over the browser language', () => {
    expect(buildWeekView(input({ browserLanguage: 'de' })).hourCycle).toBe('h12');
  });
});

describe('items at the span boundaries', () => {
  it('puts an item at exactly 00:00 in its new span, and one at 23:59:59.999 in the old one', () => {
    const items = [
      task('a', '2026-11-03T04:59:59.999Z'),
      task('b', '2026-11-03T05:00:00Z'),
      task('c', '2026-11-10T04:59:59.999Z'),
      task('d', '2026-11-10T05:00:00Z'),
      task('e', '2026-11-03T05:30:00Z'),
      task('f', '2026-11-03T06:30:00Z'),
    ];
    const nextSpan = buildWeekView(input({ spanOffset: 1, plannerItems: items }));
    expect(nextSpan).toMatchObject({ spanStart: '2026-11-03', spanEnd: '2026-11-09' });
    expect(placesOf(nextSpan)).toEqual({
      'assignment:b': 'day@2026-11-03.items',
      'assignment:e': 'day@2026-11-03.items',
      'assignment:f': 'day@2026-11-03.items',
      'assignment:c': 'day@2026-11-09.items',
    });
    const thisSpan = buildWeekView(input({ plannerItems: items }));
    expect(placesOf(thisSpan)).toEqual({ 'assignment:a': 'day@2026-11-02.items' });
  });
});

describe('time zones', () => {
  it('groups by day in Asia/Tokyo and labels the zone when the browser differs', () => {
    const view = buildWeekView(
      input({
        now: '2026-10-27T15:30:00Z',
        profile: {
          id: '1',
          name: 'Sam',
          time_zone: 'Asia/Tokyo',
          locale: null,
          effective_locale: 'ja',
        },
        plannerItems: [task('1', '2026-10-27T16:00:00Z'), task('2', '2026-10-27T14:00:00Z')],
      }),
    );
    expect(view).toMatchObject({
      today: '2026-10-28',
      timeZone: 'Asia/Tokyo',
      browserTimeZoneDiffers: true,
      hourCycle: 'h23',
    });
    expect(placesOf(view)).toEqual({
      'assignment:1': 'today@2026-10-28.items',
      'assignment:2': 'past_due.items',
    });
  });

  it('groups by day in Pacific/Auckland', () => {
    const view = buildWeekView(
      input({
        browserTimeZone: 'Pacific/Auckland',
        profile: {
          id: '1',
          name: 'Sam',
          time_zone: 'Pacific/Auckland',
          locale: null,
          effective_locale: 'en-AU',
        },
        plannerItems: [task('1', '2026-10-27T10:30:00Z'), task('2', '2026-10-28T10:30:00Z')],
      }),
    );
    expect(view).toMatchObject({
      today: '2026-10-28',
      spanStart: '2026-10-28',
      spanEnd: '2026-11-03',
      browserTimeZoneDiffers: false,
    });
    expect(placesOf(view)).toEqual({
      'assignment:1': 'past_due.items',
      'assignment:2': 'today@2026-10-28.items',
    });
  });

  it('treats zone aliases as the same zone', () => {
    expect(buildWeekView(input({ browserTimeZone: 'US/Eastern' })).browserTimeZoneDiffers).toBe(
      false,
    );
  });

  it('falls back to the browser zone when Canvas sends an unknown zone', () => {
    const view = buildWeekView(
      input({
        profile: {
          id: '1',
          name: 'Sam',
          time_zone: 'Mars/Base',
          locale: null,
          effective_locale: 'en',
        },
      }),
    );
    expect(view.timeZone).toBe('America/New_York');
  });
});

describe('the Past due group', () => {
  it('collapses items more than 7 days old under older', () => {
    const view = buildWeekView(
      input({
        plannerItems: [
          task('recent', '2026-10-20T18:00:00Z'),
          task('old', '2026-10-20T17:59:59.999Z'),
        ],
      }),
    );
    expect(placesOf(view)).toEqual({
      'assignment:recent': 'past_due.items',
      'assignment:old': 'past_due.older',
    });
  });

  it('shows items from the course horizon on, and caps the horizon at 16 weeks', () => {
    const view = buildWeekView(
      input({
        courses: [
          biology,
          course('505', 'Orientation', '2024-01-01T05:00:00Z'),
          course('606', 'Writing', null),
        ],
        plannerItems: [
          task('at-term-start', '2026-08-24T04:00:00Z'),
          task('before-term', '2026-08-24T03:59:59.999Z'),
          task('at-cap', '2026-07-07T04:00:00Z', { courseId: '505' }),
          task('before-cap', '2026-07-07T03:59:59.999Z', { courseId: '505' }),
          task('no-term', '2026-07-08T12:00:00Z', { courseId: '606' }),
          plannerItem({ type: 'planner_note', id: 'n1', date: '2026-07-06T12:00:00Z' }),
          plannerItem({ type: 'planner_note', id: 'n2', date: '2026-07-08T12:00:00Z' }),
        ],
      }),
    );
    expect(placesOf(view)).toEqual({
      'assignment:at-term-start': 'past_due.older',
      'assignment:at-cap': 'past_due.older',
      'assignment:no-term': 'past_due.older',
      'planner_note:n2': 'past_due.older',
    });
  });

  it('shows work due earlier today and counts it in the ring while the term starts later', () => {
    const futureTerm = course('101', 'Biology', '2026-11-02T05:00:00Z');
    const view = buildWeekView(
      input({
        courses: [futureTerm],
        plannerItems: [
          task('earlier-today', '2026-10-27T14:00:00Z'),
          task('yesterday', '2026-10-26T16:00:00Z'),
          task('friday', '2026-10-30T16:00:00Z'),
        ],
      }),
    );
    expect(placesOf(view)).toEqual({
      'assignment:earlier-today': 'past_due.items',
      'assignment:friday': 'day@2026-10-30.items',
    });
    expect(view.rings[0]).toMatchObject({ done: 0, total: 2, pastDue: 1 });
  });

  it('starts at the course start when the course dates replace the term dates', () => {
    const ownDates = {
      ...course('101', 'Biology', '2026-08-24T04:00:00Z'),
      start_at: '2026-08-10T04:00:00Z',
      restrict_enrollments_to_course_dates: true,
    };
    const view = buildWeekView(
      input({
        courses: [ownDates],
        plannerItems: [
          task('before-term', '2026-08-12T16:00:00Z'),
          task('before-course', '2026-08-09T16:00:00Z'),
        ],
      }),
    );
    expect(placesOf(view)).toEqual({ 'assignment:before-term': 'past_due.older' });
  });

  it('holds past-due items from before today and from earlier today, not their day', () => {
    const view = buildWeekView(
      input({
        plannerItems: [
          task('sun', '2026-10-25T16:00:00Z'),
          task('today-am', '2026-10-27T13:00:00Z'),
        ],
      }),
    );
    expect(placesOf(view)).toEqual({
      'assignment:sun': 'past_due.items',
      'assignment:today-am': 'past_due.items',
    });
    expect(findItem(view, 'assignment:sun').chip).toBeNull();
  });

  it('puts work due exactly now in Today', () => {
    const view = buildWeekView(input({ plannerItems: [task('now', TUESDAY_2PM)] }));
    expect(placeOf(view, 'assignment:now')).toBe('today@2026-10-27.items');
  });
});

describe('Done', () => {
  it('holds done items of the span and earlier done items with a warning only', () => {
    const view = buildWeekView(
      input({
        plannerItems: [
          task('in-span', '2026-10-27T16:00:00Z', { submissions: { submitted: true } }),
          task('yesterday', '2026-10-26T16:00:00Z', { submissions: { submitted: true } }),
          task('later-in-span', '2026-10-30T16:00:00Z', { submissions: { graded: true } }),
          task('earlier-plain', '2026-10-14T16:00:00Z', { submissions: { submitted: true } }),
          task('earlier-redo', '2026-10-14T17:00:00Z', {
            submissions: { redo_request: true },
            override: override('o1', { markedComplete: true, dismissed: false }),
          }),
          task('before-horizon', '2026-08-01T17:00:00Z', {
            submissions: { redo_request: true },
            override: override('o2', { markedComplete: true, dismissed: false }),
          }),
        ],
        assignmentDetails: detailsById([
          upload('earlier-redo', { types: ['on_paper'] }),
          upload('before-horizon', { types: ['on_paper'] }),
        ]),
      }),
    );
    expect(placesOf(view)).toEqual({
      'assignment:earlier-redo': 'done.items',
      'assignment:in-span': 'done.items',
      'assignment:later-in-span': 'done.items',
    });
    expect(view.groups.find((group) => group.kind === 'done')?.warningCount).toBe(1);
    expect(view.rings[0]).toMatchObject({ done: 2, total: 2, pastDue: 0 });
  });

  it('holds a done undated item with a warning, and counts the warning', () => {
    const view = buildWeekView(
      input({
        undatedAssignments: [
          upload('u-plain', { submission: { submitted_at: '2026-10-20T10:00:00Z' } }),
          assignment({
            id: 'u-redo',
            courseId: '101',
            types: ['on_paper'],
            submission: { redo_request: true },
          }),
        ],
        plannerItems: [
          task('in-span', '2026-10-27T16:00:00Z', { submissions: { submitted: true } }),
        ],
        overrides: [
          override('o2', { markedComplete: true, dismissed: false }, { assignmentId: 'u-redo' }),
        ],
      }),
    );
    expect(placesOf(view)).toEqual({
      'assignment:in-span': 'done.items',
      'assignment:u-redo': 'done.items',
      'assignment:u-plain': 'no_due_date.doneUndated',
    });
    const done = view.groups.find((group) => group.kind === 'done');
    expect(done?.items.map((item) => item.key)).toEqual([
      'assignment:in-span',
      'assignment:u-redo',
    ]);
    expect(done?.warningCount).toBe(1);
    expect(findItem(view, 'assignment:u-redo')).toMatchObject({
      doneChips: [{ kind: 'redo_requested' }],
      hasWarning: true,
      isLookAhead: false,
    });
    expect(view.rings[0]).toMatchObject({ done: 1, total: 1 });
  });

  it('does not hold earlier warnings in other spans', () => {
    const view = buildWeekView(
      input({
        spanOffset: 1,
        plannerItems: [
          task('earlier-redo', '2026-10-14T17:00:00Z', {
            submissions: { redo_request: true },
            override: override('o1', { markedComplete: true, dismissed: false }),
          }),
        ],
        assignmentDetails: detailsById([upload('earlier-redo', { types: ['on_paper'] })]),
      }),
    );
    expect(view.groups).toEqual([]);
  });
});

describe('checked but missing', () => {
  const checked = override('o1', { markedComplete: true, dismissed: false });

  it('stays in Past due, checked with the red chip and Skip, and counts as not done', () => {
    const view = buildWeekView(
      input({
        plannerItems: [
          task('recent', '2026-10-27T14:00:00Z', {
            submissions: { missing: true },
            override: checked,
          }),
          task('older', '2026-10-14T17:00:00Z', {
            submissions: { missing: true },
            override: override('o2', { markedComplete: true, dismissed: false }),
          }),
          task('plain', '2026-10-27T17:00:00Z', {
            override: override('o3', { markedComplete: true, dismissed: false }),
          }),
          task('before-horizon', '2026-08-01T17:00:00Z', {
            submissions: { missing: true },
            override: override('o4', { markedComplete: true, dismissed: false }),
          }),
        ],
        assignmentDetails: detailsById([
          upload('recent', { lockAt: '2026-10-27T04:00:00Z' }),
          upload('older'),
          upload('plain'),
          upload('before-horizon'),
        ]),
      }),
    );
    expect(placesOf(view)).toEqual({
      'assignment:recent': 'past_due.items',
      'assignment:older': 'past_due.older',
      'assignment:plain': 'done.items',
    });
    expect(findItem(view, 'assignment:recent')).toMatchObject({
      state: 'done',
      chip: null,
      doneChips: [{ kind: 'missing_in_canvas', teacherSet: false }],
      hasWarning: true,
      canSkip: true,
      // Like open work, a closed item shows it: Skip is the right action.
      availability: { kind: 'closed' },
    });
    expect(view.groups.find((group) => group.kind === 'done')?.warningCount).toBe(0);
    // Two items count as past due, and only the plain checked item counts as done.
    expect(view.rings[0]).toMatchObject({ done: 1, total: 2, pastDue: 2 });
  });

  it('keeps the place of open work: its day in other weeks and later this week, and No due date', () => {
    const missingChecked = { submissions: { missing: true }, override: checked };
    const lastWeek = buildWeekView(
      input({
        spanOffset: -1,
        plannerItems: [task('last-week', '2026-10-21T16:00:00Z', missingChecked)],
      }),
    );
    expect(placesOf(lastWeek)).toEqual({ 'assignment:last-week': 'day@2026-10-21.items' });
    expect(findItem(lastWeek, 'assignment:last-week')).toMatchObject({
      state: 'done',
      chip: null,
      canSkip: false,
    });
    expect(lastWeek.rings[0]).toMatchObject({ done: 0, total: 1 });

    const thisWeek = buildWeekView(
      input({
        plannerItems: [task('friday', '2026-10-30T16:00:00Z', missingChecked)],
        undatedAssignments: [upload('undated', { submission: { missing: true } })],
        overrides: [
          override('o5', { markedComplete: true, dismissed: false }, { assignmentId: 'undated' }),
        ],
      }),
    );
    expect(placesOf(thisWeek)).toEqual({
      'assignment:friday': 'day@2026-10-30.items',
      'assignment:undated': 'no_due_date.items',
    });
    expect(findItem(thisWeek, 'assignment:undated')).toMatchObject({
      state: 'done',
      canSkip: true,
      doneChips: [{ kind: 'missing_in_canvas', teacherSet: false }],
    });
    expect(thisWeek.rings[0]).toMatchObject({ done: 0, total: 1, pastDue: 0 });
  });

  it('stays in place when unchecked, and leaves only when skipped or Canvas clears missing', () => {
    const place = (flags: { markedComplete: boolean; dismissed: boolean }, missing: boolean) =>
      placesOf(
        buildWeekView(
          input({
            plannerItems: [
              task('work', '2026-10-27T16:00:00Z', {
                submissions: { missing },
                override: override('o1', flags),
              }),
            ],
          }),
        ),
      )['assignment:work'];

    expect(place({ markedComplete: true, dismissed: false }, true)).toBe('past_due.items');
    expect(place({ markedComplete: false, dismissed: false }, true)).toBe('past_due.items');
    // A module "Mark as done" sets both flags: still checked, and still in view.
    expect(place({ markedComplete: true, dismissed: true }, true)).toBe('past_due.items');
    // A Skip of checked missing work sends `marked_complete` false.
    expect(place({ markedComplete: false, dismissed: true }, true)).toBe('past_due.skipped');
    expect(place({ markedComplete: true, dismissed: false }, false)).toBe('done.items');
  });

  it('leaves reminders on their own day', () => {
    const view = buildWeekView(
      input({
        plannerItems: [
          task('reminder', '2026-10-26T16:00:00Z', {
            submissions: { missing: true },
            override: checked,
          }),
        ],
        assignmentDetails: detailsById([upload('reminder', { types: ['not_graded'] })]),
      }),
    );
    expect(placesOf(view)).toEqual({});
  });
});

describe('reminders', () => {
  const reminderDetails = detailsById(
    ['r-yesterday', 'r-today-past', 'r-today-done', 'r-friday', 'r-undated'].map((id) =>
      assignment({ id, courseId: '101', types: ['not_graded'] }),
    ),
  );

  it('show only on their day, never in Past due, No due date or the rings', () => {
    const view = buildWeekView(
      input({
        plannerItems: [
          task('r-yesterday', '2026-10-26T16:00:00Z'),
          task('r-today-past', '2026-10-27T13:00:00Z'),
          task('r-today-done', '2026-10-27T15:00:00Z', {
            override: override('o1', { markedComplete: true, dismissed: false }),
          }),
          task('r-friday', '2026-10-30T16:00:00Z'),
        ],
        assignmentDetails: reminderDetails,
        undatedAssignments: [assignment({ id: 'r-undated', courseId: '101', types: ['none'] })],
      }),
    );
    expect(placesOf(view)).toEqual({
      'assignment:r-today-past': 'today@2026-10-27.items',
      'assignment:r-today-done': 'today@2026-10-27.items',
      'assignment:r-friday': 'day@2026-10-30.items',
    });
    expect(findItem(view, 'assignment:r-today-past')).toMatchObject({
      chip: null,
      canSkip: false,
      state: 'open',
    });
    expect(findItem(view, 'assignment:r-today-done').state).toBe('done');
    expect(view.rings).toEqual([]);
  });

  it('stay on their day with no Past due chip in a past week', () => {
    const view = buildWeekView(
      input({
        spanOffset: -1,
        plannerItems: [
          task('r-friday', '2026-10-20T16:00:00Z'),
          task('work', '2026-10-20T17:00:00Z'),
        ],
        assignmentDetails: { ...reminderDetails, ...detailsById([upload('work')]) },
      }),
    );
    expect(placesOf(view)).toEqual({
      'assignment:r-friday': 'day@2026-10-20.items',
      'assignment:work': 'day@2026-10-20.items',
    });
    expect(findItem(view, 'assignment:r-friday').chip).toBeNull();
    expect(findItem(view, 'assignment:work').chip).toEqual({ kind: 'past_due' });
  });
});

describe('peer reviews', () => {
  it('reach the view with the peer_review kind for the "Peer review" subtitle, for both types', () => {
    const view = buildWeekView(
      input({
        plannerItems: [
          plannerItem({
            type: 'assessment_request',
            id: '72',
            courseId: '101',
            date: '2026-10-29T16:00:00Z',
            title: 'Lab report 3: Photosynthesis',
          }),
          plannerItem({
            type: 'peer_review_sub_assignment',
            id: '71',
            courseId: '101',
            date: '2026-10-30T16:00:00Z',
            title: 'Essay 2',
          }),
          task('1', '2026-10-29T17:00:00Z', { title: 'Lab report 3: Photosynthesis' }),
        ],
        assignmentDetails: detailsById([upload('1')]),
      }),
    );
    expect(findItem(view, 'assessment_request:72')).toMatchObject({
      kind: 'peer_review',
      title: 'Lab report 3: Photosynthesis',
      subtitleTag: null,
      handIn: 'canvas',
      handInChip: null,
    });
    expect(findItem(view, 'peer_review_sub_assignment:71')).toMatchObject({
      kind: 'peer_review',
      title: 'Essay 2',
      subtitleTag: null,
      handIn: 'canvas',
      handInChip: null,
    });
    expect(findItem(view, 'assignment:1').kind).toBe('assignment');
  });
});

describe('items whose details are still loading', () => {
  it('render at once with no hand-in chip, and keep their place when the details arrive', () => {
    const items = [task('1', '2026-10-26T16:00:00Z'), task('2', '2026-10-29T16:00:00Z')];
    const before = buildWeekView(input({ plannerItems: items }));
    const after = buildWeekView(
      input({
        plannerItems: items,
        assignmentDetails: detailsById([
          assignment({
            id: '1',
            courseId: '101',
            types: ['external_tool'],
            toolUrl: 'https://www.gradescope.com/x',
          }),
          upload('2', { lockAt: '2026-10-29T16:00:00Z' }),
        ]),
      }),
    );
    expect(placesOf(before)).toEqual(placesOf(after));
    expect(findItem(before, 'assignment:1')).toMatchObject({
      handIn: null,
      handInChip: null,
      chip: null,
      availability: null,
    });
    expect(findItem(after, 'assignment:1').chip).toEqual({
      kind: 'cant_confirm',
      tool: 'Gradescope',
      onPaper: false,
    });
  });
});

describe('No due date', () => {
  it('shows only in the current week', () => {
    const undated = [upload('u1')];
    expect(placeOf(buildWeekView(input({ undatedAssignments: undated })), 'assignment:u1')).toBe(
      'no_due_date.items',
    );
    expect(
      placeOf(
        buildWeekView(input({ spanOffset: 1, undatedAssignments: undated })),
        'assignment:u1',
      ),
    ).toBeUndefined();
  });

  it('gives a tool with no readable name a null name, for the UI to fill in', () => {
    const view = buildWeekView(
      input({
        undatedAssignments: [
          assignment({
            id: 'u3',
            courseId: '101',
            types: ['external_tool'],
            toolUrl: 'https://10.0.0.5/launch',
          }),
        ],
      }),
    );
    expect(findItem(view, 'assignment:u3').handInChip).toEqual({ kind: 'tool', name: null });
  });

  it('shows outside work with its tool chip', () => {
    const view = buildWeekView(
      input({
        undatedAssignments: [assignment({ id: 'u2', courseId: '101', types: ['on_paper'] })],
      }),
    );
    expect(findItem(view, 'assignment:u2')).toMatchObject({
      handInChip: { kind: 'on_paper' },
      chip: null,
      canSkip: true,
    });
  });
});

describe('nothing due', () => {
  it('is false when the span has items, even when none of them is in a day group', () => {
    const view = buildWeekView(
      input({
        plannerItems: [
          task('late', '2026-10-26T16:00:00Z'),
          task('done', '2026-10-30T16:00:00Z', { submissions: { submitted: true } }),
        ],
      }),
    );
    expect(view.nothingDue).toBe(false);
    expect(view.groups.map((group) => group.kind)).toEqual(['past_due', 'done']);
    expect(view.rings[0]).toMatchObject({ done: 1, total: 1, pastDue: 1 });
  });

  it('is false in another span whose items are all done', () => {
    const view = buildWeekView(
      input({
        spanOffset: -1,
        plannerItems: [
          task('1', '2026-10-20T16:00:00Z', { submissions: { submitted: true } }),
          task('2', '2026-10-22T16:00:00Z', { submissions: { graded: true } }),
        ],
      }),
    );
    expect(view.nothingDue).toBe(false);
    expect(view.groups.map((group) => group.kind)).toEqual(['done']);
    expect(view.rings[0]).toMatchObject({ done: 2, total: 2 });
  });

  it('is true when only earlier days fill Past due, and No due date and Done still show', () => {
    const view = buildWeekView(
      input({
        plannerItems: [
          task('last-week', '2026-10-20T16:00:00Z'),
          task('earlier-redo', '2026-10-14T17:00:00Z', {
            submissions: { redo_request: true },
            override: override('o1', { markedComplete: true, dismissed: false }),
          }),
        ],
        assignmentDetails: detailsById([
          upload('last-week'),
          upload('earlier-redo', { types: ['on_paper'] }),
        ]),
        undatedAssignments: [upload('u')],
      }),
    );
    expect(view.nothingDue).toBe(true);
    expect(view.groups.map((group) => group.kind)).toEqual(['past_due', 'no_due_date', 'done']);
  });

  it('is true when only the Tomorrow look-ahead after a Day span has items', () => {
    const view = buildWeekView(
      input({
        now: SATURDAY_2PM,
        settings: { ...DEFAULT_SETTINGS, span: { kind: 'day', days: 7 } },
        plannerItems: [task('1', '2026-11-01T15:00:00Z')],
      }),
    );
    expect(view.nothingDue).toBe(true);
    expect(view.groups.map((group) => group.kind)).toEqual(['tomorrow']);
  });

  it('is true when the reminders of the span are on earlier days, which do not show', () => {
    const view = buildWeekView(
      input({
        plannerItems: [task('r', '2026-10-26T16:00:00Z')],
        assignmentDetails: detailsById([
          assignment({ id: 'r', courseId: '101', types: ['not_graded'] }),
        ]),
      }),
    );
    expect(view).toMatchObject({ nothingDue: true, groups: [] });
  });

  it('follows the course filter', () => {
    const history = course('202', 'History', '2026-08-24T04:00:00Z');
    const plannerItems = [task('1', '2026-10-29T16:00:00Z')];
    const all = buildWeekView(input({ courses: [biology, history], plannerItems }));
    const filtered = buildWeekView(
      input({ courses: [biology, history], plannerItems, courseFilter: '202' }),
    );
    expect(all.nothingDue).toBe(false);
    expect(filtered.nothingDue).toBe(true);
  });

  it('is true for an empty week with no groups', () => {
    const view = buildWeekView(input());
    expect(view).toMatchObject({ nothingDue: true, groups: [], rings: [] });
  });
});

describe('hidden courses', () => {
  it('counts only hidden courses that the student has', () => {
    const view = buildWeekView(
      input({
        courses: [biology, course('202', 'History')],
        settings: { ...DEFAULT_SETTINGS, hiddenCourseIds: ['202', '999'] },
        plannerItems: [task('1', '2026-10-29T16:00:00Z', { courseId: '202' })],
      }),
    );
    expect(view.hiddenCourseCount).toBe(1);
    expect(view.groups).toEqual([]);
  });

  it('hides group items that count under a hidden course', () => {
    const view = buildWeekView(
      input({
        courses: [biology, course('202', 'History')],
        groups: [{ id: '9', name: 'Team', context_type: 'Course', course_id: '202' }],
        settings: { ...DEFAULT_SETTINGS, hiddenCourseIds: ['202'] },
        plannerItems: [
          plannerItem({ type: 'wiki_page', id: 'p', groupId: '9', date: '2026-10-29T16:00:00Z' }),
        ],
      }),
    );
    expect(view.groups).toEqual([]);
  });
});

describe('a scoped course', () => {
  const history = course('202', 'History');
  const scoped = (hiddenCourseIds: string[]) =>
    buildWeekView(
      input({
        courses: [biology, history],
        scopeCourseId: '202',
        settings: { ...DEFAULT_SETTINGS, hiddenCourseIds },
        plannerItems: [
          task('1', '2026-10-29T16:00:00Z'),
          task('2', '2026-10-29T16:00:00Z', { courseId: '202' }),
        ],
        undatedAssignments: [assignment({ id: '3', courseId: '202', types: ['online_upload'] })],
      }),
    );

  it('shows only that course', () => {
    const view = scoped([]);
    expect(view).toMatchObject({ scopeCourseId: '202', scopeCourseHidden: false });
    expect(placesOf(view)).toEqual({
      'assignment:2': 'day@2026-10-29.items',
      'assignment:3': 'no_due_date.items',
    });
    expect(view.rings.map((ring) => ring.courseId)).toEqual(['202']);
  });

  it('is marked hidden, with no groups and no rings, when the student hid it', () => {
    const view = scoped(['202']);
    expect(view).toMatchObject({
      scopeCourseId: '202',
      scopeCourseHidden: true,
      groups: [],
      rings: [],
      hiddenCourseCount: 1,
    });
  });

  it('is not marked hidden when another course is hidden', () => {
    expect(scoped(['101'])).toMatchObject({ scopeCourseHidden: false });
    expect(buildWeekView(input()).scopeCourseHidden).toBe(false);
  });
});

describe('item colors', () => {
  it('color every item by its course, also with the rings turned off', () => {
    const view = buildWeekView(
      input({
        colors: { custom_colors: { course_101: '#2E7D32', user_1: '#6A1B9A' } },
        settings: { ...DEFAULT_SETTINGS, showRings: false },
        plannerItems: [
          task('1', '2026-10-29T16:00:00Z'),
          plannerItem({ type: 'planner_note', id: 'n', date: '2026-10-29T17:00:00Z' }),
        ],
        undatedAssignments: [upload('u')],
      }),
    );
    expect(view.rings).toEqual([]);
    expect(findItem(view, 'assignment:1').color).toBe('#2E7D32');
    expect(findItem(view, 'assignment:u').color).toBe('#2E7D32');
    expect(findItem(view, 'planner_note:n').color).toBe('#6A1B9A');
  });

  it('match the ring color of the same course', () => {
    const view = buildWeekView(input({ plannerItems: [task('1', '2026-10-29T16:00:00Z')] }));
    expect(findItem(view, 'assignment:1').color).toBe(view.rings[0]?.color);
  });
});

describe('the planner-off list', () => {
  it('builds the same list from all assignments and the override list', () => {
    const view = buildWeekView(
      input({
        limited: true,
        plannerItems: [
          plannerItem({ type: 'planner_note', id: 'n', date: '2026-10-29T16:00:00Z' }),
        ],
        allAssignments: [
          upload('1', { due: '2026-10-29T16:00:00Z' }),
          upload('2', { due: '2026-10-26T16:00:00Z', submission: { missing: true } }),
          upload('3', {
            due: '2026-10-28T16:00:00Z',
            submission: { submitted_at: '2026-10-27T10:00:00Z' },
          }),
          upload('4', { due: '2026-10-30T16:00:00Z' }),
          upload('5'),
          upload('6', { due: '2026-11-20T16:00:00Z' }),
          upload('7', { due: '2026-01-10T16:00:00Z' }),
          assignment({
            id: '8',
            courseId: '101',
            types: ['discussion_topic'],
            hasSubAssignments: true,
          }),
        ],
        overrides: [
          override('o4', { markedComplete: true, dismissed: false }, { assignmentId: '4' }),
        ],
      }),
    );
    expect(view.limited).toBe(true);
    expect(placesOf(view)).toEqual({
      'assignment:2': 'past_due.items',
      'assignment:1': 'day@2026-10-29.items',
      'assignment:3': 'done.items',
      'assignment:4': 'done.items',
      'assignment:5': 'no_due_date.items',
    });
    expect(findItem(view, 'assignment:2').chip).toEqual({ kind: 'missing' });
    expect(findItem(view, 'assignment:4').override).toEqual({
      id: 'o4',
      markedComplete: true,
      dismissed: false,
    });
  });
});

describe('item actions', () => {
  it('offers Skip only on open items in Past due and No due date', () => {
    const view = buildWeekView(
      input({
        plannerItems: [task('late', '2026-10-26T16:00:00Z'), task('soon', '2026-10-29T16:00:00Z')],
        undatedAssignments: [upload('u')],
      }),
    );
    expect(findItem(view, 'assignment:late').canSkip).toBe(true);
    expect(findItem(view, 'assignment:u').canSkip).toBe(true);
    expect(findItem(view, 'assignment:soon').canSkip).toBe(false);
  });

  it('shows a redo request on dismissed Canvas work that was marked done, in Past due and the ring', () => {
    const view = buildWeekView(
      input({
        plannerItems: [
          task('redo', '2026-10-27T14:00:00Z', {
            submissions: { submitted: true, redo_request: true },
            override: override('o', { markedComplete: true, dismissed: true }),
          }),
          task('skipped-redo', '2026-10-27T15:00:00Z', {
            submissions: { submitted: true, redo_request: true },
            override: override('p', { markedComplete: false, dismissed: true }),
          }),
        ],
        assignmentDetails: detailsById([upload('redo'), upload('skipped-redo')]),
      }),
    );
    expect(placesOf(view)).toEqual({
      'assignment:redo': 'past_due.items',
      'assignment:skipped-redo': 'past_due.skipped',
    });
    expect(findItem(view, 'assignment:redo')).toMatchObject({
      state: 'open',
      chip: { kind: 'redo_requested' },
      checkboxDisabled: true,
      canSkip: true,
    });
    expect(findItem(view, 'assignment:skipped-redo')).toMatchObject({
      state: 'skipped',
      chip: { kind: 'skipped' },
    });
    expect(view.rings[0]).toMatchObject({ done: 0, total: 1, pastDue: 1 });
  });

  it('keeps a skipped item on its day with a Skipped chip', () => {
    const view = buildWeekView(
      input({
        plannerItems: [
          task('s', '2026-10-29T16:00:00Z', {
            override: override('o', { markedComplete: false, dismissed: true }),
          }),
        ],
      }),
    );
    expect(placeOf(view, 'assignment:s')).toBe('day@2026-10-29.items');
    expect(findItem(view, 'assignment:s')).toMatchObject({
      chip: { kind: 'skipped' },
      canSkip: false,
    });
    expect(view.rings).toEqual([]);
  });

  it('offers Move to today on a custom task dated before today, in any week', () => {
    const notes = [
      plannerItem({ type: 'planner_note', id: 'yesterday', date: '2026-10-26T16:00:00Z' }),
      plannerItem({ type: 'planner_note', id: 'this-morning', date: '2026-10-27T13:00:00Z' }),
      plannerItem({ type: 'planner_note', id: 'last-week', date: '2026-10-21T16:00:00Z' }),
    ];
    const view = buildWeekView(input({ plannerItems: notes }));
    expect(findItem(view, 'planner_note:yesterday').canMoveToToday).toBe(true);
    expect(findItem(view, 'planner_note:this-morning').canMoveToToday).toBe(false);
    const lastWeek = buildWeekView(input({ spanOffset: -1, plannerItems: notes }));
    expect(findItem(lastWeek, 'planner_note:last-week')).toMatchObject({
      canMoveToToday: true,
      chip: { kind: 'past_due' },
    });
  });
});

describe('the shown span', () => {
  const span = (kind: Span['kind'], days = 7): Partial<ModelInput> => ({
    settings: { ...DEFAULT_SETTINGS, span: { kind, days } },
  });
  const items = [
    // Past, earlier this week.
    task('mon', '2026-10-26T15:00:00Z'),
    // Past, earlier this month and before this week.
    task('oct5', '2026-10-05T15:00:00Z'),
    // Tuesday afternoon, after the clock of the tests.
    task('today', '2026-10-27T21:00:00Z'),
    task('tomorrow', '2026-10-28T15:00:00Z'),
    task('nov3', '2026-11-03T15:00:00Z'),
    task('nov6', '2026-11-06T15:00:00Z'),
    task('nov20', '2026-11-20T15:00:00Z'),
    task('dec1', '2026-12-01T15:00:00Z'),
  ];
  const details = detailsById(items.map((item) => upload(item.plannable_id)));
  const view = (partial: Partial<ModelInput>) =>
    buildWeekView(input({ plannerItems: items, assignmentDetails: details, ...partial }));

  it('carries the span and its days in the view', () => {
    expect(view(span('fortnight'))).toMatchObject({
      span: { kind: 'fortnight', days: 7 },
      spanStart: '2026-10-27',
      spanEnd: '2026-11-09',
      isCurrentSpan: true,
      spanOffset: 0,
    });
    expect(view({ ...span('custom', 12), spanOffset: 1 })).toMatchObject({
      span: { kind: 'custom', days: 12 },
      spanStart: '2026-11-08',
      spanEnd: '2026-11-19',
      isCurrentSpan: false,
    });
  });

  it('Week starts today, and puts the work before today in Past due', () => {
    expect(placesOf(view(span('week')))).toEqual({
      'assignment:mon': 'past_due.items',
      'assignment:oct5': 'past_due.older',
      'assignment:today': 'today@2026-10-27.items',
      'assignment:tomorrow': 'tomorrow@2026-10-28.items',
    });
  });

  it('Month runs from today, with earlier work in Past due and the rest on its day', () => {
    const month = view(span('month'));
    expect(month).toMatchObject({ spanStart: '2026-10-27', spanEnd: '2026-11-26' });
    expect(placesOf(month)).toEqual({
      'assignment:mon': 'past_due.items',
      'assignment:oct5': 'past_due.older',
      'assignment:today': 'today@2026-10-27.items',
      'assignment:tomorrow': 'tomorrow@2026-10-28.items',
      'assignment:nov3': 'day@2026-11-03.items',
      'assignment:nov6': 'day@2026-11-06.items',
      'assignment:nov20': 'day@2026-11-20.items',
    });
    expect(month.rings[0]).toMatchObject({ total: 5, done: 0, pastDue: 2 });
  });

  it('Month, a month ahead, shows that month on its days and the overdue work in Past due', () => {
    const next = view({ ...span('month'), spanOffset: 1 });
    expect(next).toMatchObject({ spanStart: '2026-11-27', spanEnd: '2026-12-26' });
    expect(placesOf(next)).toEqual({
      'assignment:mon': 'past_due.items',
      'assignment:oct5': 'past_due.older',
      'assignment:dec1': 'day@2026-12-01.items',
    });
    expect(next.rings[0]).toMatchObject({ total: 1, done: 0, pastDue: 2 });
  });

  it('2 weeks shows 14 days from today, and counts them in the rings', () => {
    const fortnight = view(span('fortnight'));
    expect(placesOf(fortnight)).toEqual({
      'assignment:mon': 'past_due.items',
      'assignment:oct5': 'past_due.older',
      'assignment:today': 'today@2026-10-27.items',
      'assignment:tomorrow': 'tomorrow@2026-10-28.items',
      'assignment:nov3': 'day@2026-11-03.items',
      'assignment:nov6': 'day@2026-11-06.items',
    });
    // Work from before the span is in Past due but not in the total.
    expect(fortnight.rings[0]).toMatchObject({ total: 4, pastDue: 2 });
  });

  it('a custom span starts today, so work before today is Past due', () => {
    const custom = view(span('custom', 10));
    expect(custom).toMatchObject({ spanStart: '2026-10-27', spanEnd: '2026-11-05' });
    expect(placesOf(custom)).toEqual({
      'assignment:mon': 'past_due.items',
      'assignment:oct5': 'past_due.older',
      'assignment:today': 'today@2026-10-27.items',
      'assignment:tomorrow': 'tomorrow@2026-10-28.items',
      'assignment:nov3': 'day@2026-11-03.items',
    });
  });

  it('Day shows today, and tomorrow as the look-ahead outside the rings', () => {
    const day = view(span('day'));
    expect(day).toMatchObject({ spanStart: '2026-10-27', spanEnd: '2026-10-27' });
    expect(placesOf(day)).toEqual({
      'assignment:mon': 'past_due.items',
      'assignment:oct5': 'past_due.older',
      'assignment:today': 'today@2026-10-27.items',
      'assignment:tomorrow': 'tomorrow@2026-10-28.items',
    });
    expect(findItem(day, 'assignment:tomorrow').isLookAhead).toBe(true);
    expect(day.rings[0]).toMatchObject({ total: 1, pastDue: 2 });
  });

  it('Day, another day, shows that day and the overdue work in Past due', () => {
    const other = view({ ...span('day'), spanOffset: 7 });
    expect(other).toMatchObject({ spanStart: '2026-11-03', spanEnd: '2026-11-03' });
    expect(placesOf(other)).toEqual({
      'assignment:mon': 'past_due.items',
      'assignment:oct5': 'past_due.older',
      'assignment:nov3': 'day@2026-11-03.items',
    });
  });

  it('says nothing is due when the span holds no dated work', () => {
    expect(view({ ...span('day'), spanOffset: 1, plannerItems: [] }).nothingDue).toBe(true);
    expect(view({ ...span('month'), spanOffset: 3, plannerItems: [] }).nothingDue).toBe(true);
    expect(view(span('month')).nothingDue).toBe(false);
  });

  it('shows unsubmitted work from earlier today in Past due for any span, in a course that starts next week', () => {
    const futureCourse = [course('101', 'Biology', '2026-11-02T05:00:00Z')];
    const earlierToday = [task('mon', '2026-10-27T13:00:00Z')];
    const monDetails = detailsById([upload('mon')]);
    for (const kind of ['day', 'week', 'fortnight', 'month', 'custom'] as const) {
      const shown = buildWeekView(
        input({
          ...span(kind, 5),
          courses: futureCourse,
          plannerItems: earlierToday,
          assignmentDetails: monDetails,
        }),
      );
      expect(placesOf(shown), kind).toEqual({ 'assignment:mon': 'past_due.items' });
    }
  });

  describe('the planner range', () => {
    const range = (partial: Partial<ModelInput>) => plannerRangeFor(input(partial));

    it('ends one millisecond before the span ends', () => {
      expect(range(span('month')).end).toBe('2026-11-27T04:59:59.999Z');
      expect(range(span('fortnight')).end).toBe('2026-11-10T04:59:59.999Z');
      expect(range(span('custom', 90)).end).toBe('2027-01-25T04:59:59.999Z');
      expect(range({ ...span('month'), spanOffset: 1 }).end).toBe('2026-12-27T04:59:59.999Z');
    });

    it('ends after tomorrow for a Day, and starts at the horizon', () => {
      expect(range(span('day'))).toEqual({
        start: '2026-08-24T04:00:00.000Z',
        end: '2026-10-29T03:59:59.999Z',
      });
    });

    it('starts at the span when it is older than the horizon', () => {
      expect(range({ ...span('month'), spanOffset: -4 }).start).toBe('2026-06-27T04:00:00.000Z');
    });
  });
});

describe('Past due in every span', () => {
  /** Thursday 2026-10-29 at noon in Los Angeles, with the Canvas zone set to match. */
  const THURSDAY_NOON = '2026-10-29T19:00:00Z';
  const losAngeles = (partial: Partial<ModelInput> = {}): ModelInput => {
    const base = input({ now: THURSDAY_NOON, ...partial });
    return {
      ...base,
      browserTimeZone: 'America/Los_Angeles',
      profile: { ...base.profile, time_zone: 'America/Los_Angeles' },
    };
  };
  const items = [
    // Overdue: Tuesday, before the span that starts today.
    task('tuesday', '2026-10-27T19:00:00Z'),
    task('older', '2026-10-05T19:00:00Z'),
    // Overdue today, and open work in the span.
    task('this-morning', '2026-10-29T15:00:00Z'),
    task('soon', '2026-11-03T19:00:00Z'),
    task('later', '2026-11-06T19:00:00Z'),
  ];
  const details = detailsById(items.map((item) => upload(item.plannable_id)));
  const view = (partial: Partial<ModelInput>) =>
    buildWeekView(losAngeles({ plannerItems: items, assignmentDetails: details, ...partial }));

  it('shows Past due in the span after the one that starts today, with the late count', () => {
    const next = view({ spanOffset: 1 });
    expect(next).toMatchObject({ spanStart: '2026-11-05', spanEnd: '2026-11-11' });
    expect(placesOf(next)).toEqual({
      'assignment:tuesday': 'past_due.items',
      'assignment:this-morning': 'past_due.items',
      'assignment:older': 'past_due.older',
      'assignment:later': 'day@2026-11-06.items',
    });
    // The overdue work is no part of the total of that span, but it is late.
    expect(next.rings[0]).toMatchObject({ total: 1, done: 0, pastDue: 3 });
    // The group says it, so the items carry no Past due chip.
    expect(findItem(next, 'assignment:tuesday').chip).toBeNull();
  });

  it('shows the same Past due group in a span three spans ahead', () => {
    const far = view({ spanOffset: 3 });
    expect(placesOf(far)).toEqual({
      'assignment:tuesday': 'past_due.items',
      'assignment:this-morning': 'past_due.items',
      'assignment:older': 'past_due.older',
    });
    expect(far.nothingDue).toBe(true);
  });

  it('keeps work dated inside a span that ended before today on its day, with the chip', () => {
    const past = view({ spanOffset: -1 });
    expect(past).toMatchObject({ spanStart: '2026-10-22', spanEnd: '2026-10-28' });
    expect(placesOf(past)).toEqual({
      'assignment:tuesday': 'day@2026-10-27.items',
      // Overdue work dated outside the span goes to Past due.
      'assignment:this-morning': 'past_due.items',
      'assignment:older': 'past_due.older',
    });
    expect(findItem(past, 'assignment:tuesday').chip).toEqual({ kind: 'past_due' });
    // The late count follows the Past due group, not the work dated inside the span.
    expect(past.rings[0]).toMatchObject({ total: 1, done: 0, pastDue: 2 });
  });

  it('places every item in one place only', () => {
    for (const spanOffset of [-2, -1, 0, 1, 2, 3]) {
      const shown = view({ spanOffset });
      for (const [key, places] of placements(shown)) expect(places, key).toHaveLength(1);
    }
  });

  it('leaves out overdue work from before the horizon of the course in a later span', () => {
    const early = [task('before-term', '2026-08-01T19:00:00Z')];
    const shown = view({
      spanOffset: 1,
      plannerItems: early,
      assignmentDetails: detailsById([upload('before-term')]),
    });
    expect(placesOf(shown)).toEqual({});
  });
});
