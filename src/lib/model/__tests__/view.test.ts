import { describe, expect, it } from 'vitest';
import type { Assignment } from '../../canvas/types';
import { DEFAULT_SETTINGS, type ModelInput } from '../types';
import { buildWeekView, plannerRangeFor } from '../view';
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
} from './builders';

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

  it('starts at the earliest horizon and ends one millisecond before the week ends', () => {
    expect(range()).toEqual({
      start: '2026-08-24T04:00:00.000Z',
      end: '2026-11-01T03:59:59.999Z',
    });
  });

  it('ends at the end of tomorrow on the last day of the week, after the daylight saving change', () => {
    expect(range({ now: '2026-10-31T18:00:00Z' }).end).toBe('2026-11-02T04:59:59.999Z');
  });

  it('starts at the viewed week when the week is older than every horizon, and still ends after tomorrow', () => {
    expect(range({ weekOffset: -12 })).toEqual({
      start: '2026-08-02T04:00:00.000Z',
      end: '2026-10-29T03:59:59.999Z',
    });
  });

  it('starts no later than the current week when every term starts in the future', () => {
    const futureTerm = [course('101', 'Biology', '2026-11-02T05:00:00Z')];
    expect(range({ courses: futureTerm })).toEqual({
      start: '2026-10-25T04:00:00.000Z',
      end: '2026-11-01T03:59:59.999Z',
    });
    expect(range({ courses: futureTerm, weekOffset: 1 }).start).toBe('2026-10-25T04:00:00.000Z');
  });

  it('ignores hidden courses and uses 16 weeks when no course is visible', () => {
    expect(
      range({ weekOffset: 1, settings: { ...DEFAULT_SETTINGS, hiddenCourseIds: ['101'] } }),
    ).toEqual({ start: '2026-07-07T04:00:00.000Z', end: '2026-11-08T04:59:59.999Z' });
  });

  it('has plain UTC instants with no bracketed zone', () => {
    const tokyo = input().profile;
    const result = range({
      browserTimeZone: 'Asia/Tokyo',
      profile: { ...tokyo, time_zone: 'Asia/Tokyo' },
      settings: { ...DEFAULT_SETTINGS, weekStart: 1 },
    });
    expect(result.start).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(result.end).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.999Z$/);
  });
});

describe('the Tomorrow look-ahead', () => {
  it('shows tomorrow from the next week on the last day of a Sunday week, outside the rings', () => {
    const view = buildWeekView(
      input({
        now: SATURDAY_2PM,
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
    expect(view.weekEnd).toBe('2026-10-31');
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

  it('works with a Monday week, where Sunday is the last day', () => {
    const view = buildWeekView(
      input({
        now: '2026-11-01T19:00:00Z',
        settings: { ...DEFAULT_SETTINGS, weekStart: 1 },
        plannerItems: [task('1', '2026-11-02T16:00:00Z'), task('2', '2026-11-03T16:00:00Z')],
      }),
    );
    expect(view).toMatchObject({
      weekStart: '2026-10-26',
      weekEnd: '2026-11-01',
      today: '2026-11-01',
    });
    expect(placesOf(view)).toEqual({ 'assignment:1': 'tomorrow@2026-11-02.items' });
    expect(findItem(view, 'assignment:1').isLookAhead).toBe(true);
  });

  it('is a normal day in the middle of the week', () => {
    const view = buildWeekView(input({ plannerItems: [task('1', '2026-10-28T16:00:00Z')] }));
    expect(findItem(view, 'assignment:1')).toMatchObject({ isLookAhead: false });
    expect(view.rings[0]).toMatchObject({ total: 1 });
  });
});

describe('week starts', () => {
  it('uses a Saturday week from the Canvas language', () => {
    const view = buildWeekView(
      input({
        profile: {
          id: '1',
          name: 'Sam',
          time_zone: 'America/New_York',
          locale: null,
          effective_locale: 'ar',
        },
        plannerItems: [
          task('1', '2026-10-24T16:00:00Z'),
          task('2', '2026-10-30T16:00:00Z'),
          task('3', '2026-10-31T16:00:00Z'),
        ],
      }),
    );
    expect(view).toMatchObject({
      weekStart: '2026-10-24',
      weekEnd: '2026-10-30',
      hourCycle: 'h23',
    });
    expect(placesOf(view)).toEqual({
      'assignment:1': 'past_due.items',
      'assignment:2': 'day@2026-10-30.items',
    });
  });

  it('uses the Monday setting over the Canvas language', () => {
    const view = buildWeekView(input({ settings: { ...DEFAULT_SETTINGS, weekStart: 1 } }));
    expect(view).toMatchObject({ weekStart: '2026-10-26', weekEnd: '2026-11-01' });
  });

  it('falls back to the browser language when Canvas sends no language', () => {
    const noLanguage = { ...input().profile, locale: null, effective_locale: '' };
    const view = buildWeekView(input({ profile: noLanguage, browserLanguage: 'en-GB' }));
    expect(view).toMatchObject({
      weekStart: '2026-10-26',
      weekEnd: '2026-11-01',
      hourCycle: 'h23',
    });
    expect(
      plannerRangeFor(input({ profile: noLanguage, browserLanguage: 'en-GB', courses: [] })),
    ).toEqual({ start: '2026-07-07T04:00:00.000Z', end: '2026-11-02T04:59:59.999Z' });
    expect(buildWeekView(input({ profile: noLanguage })).weekStart).toBe('2026-10-25');
  });

  it('prefers the Canvas language over the browser language', () => {
    const view = buildWeekView(input({ browserLanguage: 'de' }));
    expect(view).toMatchObject({ weekStart: '2026-10-25' });
  });
});

describe('items at the week boundaries', () => {
  it('puts an item at exactly 00:00 in its new week, and one at 23:59:59.999 in the old one', () => {
    const items = [
      task('a', '2026-11-01T03:59:59.999Z'),
      task('b', '2026-11-01T04:00:00Z'),
      task('c', '2026-11-08T04:59:59.999Z'),
      task('d', '2026-11-08T05:00:00Z'),
      task('e', '2026-11-01T05:30:00Z'),
      task('f', '2026-11-01T06:30:00Z'),
    ];
    const nextWeek = buildWeekView(input({ weekOffset: 1, plannerItems: items }));
    expect(nextWeek).toMatchObject({ weekStart: '2026-11-01', weekEnd: '2026-11-07' });
    expect(placesOf(nextWeek)).toEqual({
      'assignment:b': 'day@2026-11-01.items',
      'assignment:e': 'day@2026-11-01.items',
      'assignment:f': 'day@2026-11-01.items',
      'assignment:c': 'day@2026-11-07.items',
    });
    const thisWeek = buildWeekView(input({ plannerItems: items }));
    expect(placesOf(thisWeek)).toEqual({ 'assignment:a': 'day@2026-10-31.items' });
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
      weekStart: '2026-10-26',
      weekEnd: '2026-11-01',
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

  it("shows this week's past-due work and counts it in the ring while the term starts later", () => {
    const futureTerm = course('101', 'Biology', '2026-11-02T05:00:00Z');
    const view = buildWeekView(
      input({
        courses: [futureTerm],
        plannerItems: [
          task('this-week', '2026-10-26T16:00:00Z'),
          task('last-week', '2026-10-24T16:00:00Z'),
          task('friday', '2026-10-30T16:00:00Z'),
        ],
      }),
    );
    expect(placesOf(view)).toEqual({
      'assignment:this-week': 'past_due.items',
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

  it('holds past-due items from earlier in the week and today, not their day', () => {
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
  it('holds done items of the week and earlier done items with a warning only', () => {
    const view = buildWeekView(
      input({
        plannerItems: [
          task('this-week', '2026-10-26T16:00:00Z', { submissions: { submitted: true } }),
          task('later-this-week', '2026-10-30T16:00:00Z', { submissions: { graded: true } }),
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
      'assignment:this-week': 'done.items',
      'assignment:later-this-week': 'done.items',
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
          task('this-week', '2026-10-26T16:00:00Z', { submissions: { submitted: true } }),
        ],
        overrides: [
          override('o2', { markedComplete: true, dismissed: false }, { assignmentId: 'u-redo' }),
        ],
      }),
    );
    expect(placesOf(view)).toEqual({
      'assignment:this-week': 'done.items',
      'assignment:u-redo': 'done.items',
      'assignment:u-plain': 'no_due_date.doneUndated',
    });
    const done = view.groups.find((group) => group.kind === 'done');
    expect(done?.items.map((item) => item.key)).toEqual([
      'assignment:this-week',
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

  it('does not hold earlier warnings in other weeks', () => {
    const view = buildWeekView(
      input({
        weekOffset: 1,
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
          task('recent', '2026-10-26T16:00:00Z', {
            submissions: { missing: true },
            override: checked,
          }),
          task('older', '2026-10-14T17:00:00Z', {
            submissions: { missing: true },
            override: override('o2', { markedComplete: true, dismissed: false }),
          }),
          task('plain', '2026-10-26T17:00:00Z', {
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
        weekOffset: -1,
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
              task('work', '2026-10-26T16:00:00Z', {
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
        weekOffset: -1,
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
        buildWeekView(input({ weekOffset: 1, undatedAssignments: undated })),
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
  it('is false when the week has items, even when none of them is in a day group', () => {
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
    expect(view.rings[0]).toMatchObject({ done: 1, total: 2, pastDue: 1 });
  });

  it('is false in another week whose items are all done', () => {
    const view = buildWeekView(
      input({
        weekOffset: -1,
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

  it('is true when only earlier weeks fill Past due, and No due date and Done still show', () => {
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

  it('is true when only the Tomorrow look-ahead from the next week has items', () => {
    const view = buildWeekView(
      input({ now: SATURDAY_2PM, plannerItems: [task('1', '2026-11-01T15:00:00Z')] }),
    );
    expect(view.nothingDue).toBe(true);
    expect(view.groups.map((group) => group.kind)).toEqual(['tomorrow']);
  });

  it('is true when the reminders of the week are on earlier days, which do not show', () => {
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
          task('redo', '2026-10-26T16:00:00Z', {
            submissions: { submitted: true, redo_request: true },
            override: override('o', { markedComplete: true, dismissed: true }),
          }),
          task('skipped-redo', '2026-10-26T17:00:00Z', {
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
    const lastWeek = buildWeekView(input({ weekOffset: -1, plannerItems: notes }));
    expect(findItem(lastWeek, 'planner_note:last-week')).toMatchObject({
      canMoveToToday: true,
      chip: { kind: 'past_due' },
    });
  });
});
