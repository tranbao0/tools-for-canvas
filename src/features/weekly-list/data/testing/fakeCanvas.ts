/**
 * A fake `CanvasApi` that answers from the scenario fixture and remembers writes, like Canvas.
 * Tests only.
 */
import type { PrioritySource, RequestPriority } from '../../../../shared/canvas/limiter';
import {
  CanvasError,
  type AnnouncementTopic,
  type CanvasApi,
  type NoteInput,
  type PlannerItem,
  type PlannerNote,
  type PlannerOverride,
  type TimeRange,
} from '../../../../shared/canvas/types';
import { itemKey } from '../../model/normalize';
import { plannerItemsInRange, type Scenario } from '../../../../../tests/fixtures/scenario';
import { notePlannerItem, plannerItemKey } from '../patches';

export type FakeMethod = Exclude<keyof CanvasApi, 'origin' | 'withPriority'>;

interface FakeCall {
  method: FakeMethod;
  args: unknown[];
  /** The priority the call was sent with. */
  priority: RequestPriority;
}

interface Failure {
  error: unknown;
  /** How many more calls fail. */
  remaining: number;
  /** Only calls whose first argument equals this value fail. */
  firstArg?: unknown;
}

export interface FakeCanvas extends CanvasApi {
  readonly scenario: Scenario;
  readonly calls: FakeCall[];
  /** The arguments of every call to one method. */
  callsOf(method: FakeMethod): unknown[][];
  /** The planner ranges asked for, in order. */
  plannerRanges(): TimeRange[];
  /** Makes the next `times` calls of a method reject with `error`. */
  fail(method: FakeMethod, error: unknown, options?: { times?: number; firstArg?: unknown }): void;
  /** Makes calls of a method wait until the returned function runs. */
  hold(method: FakeMethod): () => void;
  /** Like `hold`, for the calls whose arguments `match` selects. */
  holdIf(method: FakeMethod, match: (args: unknown[]) => boolean): () => void;
  /** Makes the calls of a method that `match` selects reject with `error`. */
  failIf(method: FakeMethod, match: (args: unknown[]) => boolean, error: unknown): void;
  /** Sets the announcements that Canvas lists for a course, and returns by id. */
  setAnnouncements(courseId: string, topics: AnnouncementTopic[]): void;
  /** Forgets the recorded calls. */
  resetCalls(): void;
  /** Overrides that Canvas holds now, as `GET /api/v1/planner/overrides` lists them. */
  overrides(): PlannerOverride[];
  /** Adds an override that another Canvas client created. */
  addOverrideElsewhere(override: PlannerOverride): void;
}

export function canvasError(kind: CanvasError['kind'], status?: number): CanvasError {
  return new CanvasError(kind, `fake ${kind}`, status);
}

function overrideKey(override: PlannerOverride): string {
  return override.assignment_id !== null && override.assignment_id !== ''
    ? `assignment:${override.assignment_id}`
    : itemKey(
        override.plannable_type as PlannerItem['plannable_type'],
        override.plannable_id,
        null,
      );
}

export function createFakeCanvas(scenario: Scenario): FakeCanvas {
  const calls: FakeCall[] = [];
  const failures = new Map<FakeMethod, Failure[]>();
  const holds = new Map<FakeMethod, Promise<void>>();
  const conditionalHolds: {
    method: FakeMethod;
    match: (args: unknown[]) => boolean;
    wait: Promise<void>;
  }[] = [];
  const conditionalFailures: {
    method: FakeMethod;
    match: (args: unknown[]) => boolean;
    error: unknown;
  }[] = [];
  /** Overrides by item key: the embedded ones, the listed ones and the written ones. */
  const overrides = new Map<string, PlannerOverride>();
  const notes = new Map<string, PlannerNote | null>();
  const announcements = new Map<string, AnnouncementTopic[]>();
  let nextId = 90001;

  for (const item of scenario.plannerItems) {
    if (item.planner_override !== null) overrides.set(plannerItemKey(item), item.planner_override);
  }
  for (const override of scenario.plannerOverrides) overrides.set(overrideKey(override), override);

  async function call<T>(
    method: FakeMethod,
    args: unknown[],
    run: () => T,
    priority: PrioritySource,
  ): Promise<T> {
    calls.push({ method, args, priority: typeof priority === 'function' ? priority() : priority });
    await holds.get(method);
    for (const hold of conditionalHolds) {
      if (hold.method === method && hold.match(args)) await hold.wait;
    }
    const matched = conditionalFailures.find(
      (entry) => entry.method === method && entry.match(args),
    );
    if (matched !== undefined) throw matched.error;
    const list = failures.get(method) ?? [];
    const failure = list.find(
      (entry) =>
        entry.remaining > 0 && (entry.firstArg === undefined || entry.firstArg === args[0]),
    );
    if (failure !== undefined) {
      failure.remaining -= 1;
      throw failure.error;
    }
    return structuredClone(run());
  }

  function plannerItems(range: TimeRange): PlannerItem[] {
    const userId = scenario.self.id;
    const context = { courses: scenario.courses, userId };
    const items: PlannerItem[] = plannerItemsInRange(scenario, range)
      .filter(
        (item) =>
          !(item.plannable_type === 'planner_note' && notes.get(item.plannable_id) === null),
      )
      .map((item) => {
        if (item.plannable_type === 'planner_note') {
          const note = notes.get(item.plannable_id);
          if (note) return notePlannerItem(noteValue(note), item, context);
        }
        return item;
      });
    for (const note of notes.values()) {
      if (note === null || items.some((item) => isNote(item, note.id))) continue;
      const start = Date.parse(range.start);
      const end = Date.parse(range.end);
      const date = Date.parse(note.todo_date);
      if (date >= start && date <= end)
        items.push(notePlannerItem(noteValue(note), undefined, context));
    }
    return items.map((item) => ({
      ...item,
      planner_override: overrides.get(plannerItemKey(item)) ?? null,
    }));
  }

  function isNote(item: PlannerItem, id: string): boolean {
    return item.plannable_type === 'planner_note' && item.plannable_id === id;
  }

  function noteValue(note: PlannerNote) {
    return {
      id: note.id,
      title: note.title,
      details: note.details,
      todoDate: note.todo_date,
      courseId: note.course_id,
    };
  }

  function saveNote(id: string, input: NoteInput): PlannerNote {
    const note: PlannerNote = {
      id,
      title: input.title,
      details: input.details ?? null,
      todo_date: input.todoDate,
      course_id: input.courseId ?? null,
      user_id: scenario.self.id,
      workflow_state: 'active',
      created_at: scenario.now,
      updated_at: scenario.now,
    };
    notes.set(id, note);
    return note;
  }

  function methods(priority: PrioritySource): Omit<CanvasApi, 'origin' | 'withPriority'> {
    return {
      getSelf: () => call('getSelf', [], () => scenario.self, priority),
      getProfile: () => call('getProfile', [], () => scenario.profile, priority),
      listCourses: () => call('listCourses', [], () => scenario.courses, priority),
      getAnnouncement: (courseId, topicId) =>
        call(
          'getAnnouncement',
          [courseId, topicId],
          () =>
            announcements.get(courseId)?.find((topic) => topic.id === topicId) ?? {
              id: topicId,
              title: 'Announcement',
              message: null,
              posted_at: null,
            },
          priority,
        ),
      listAnnouncements: (courseId, range) =>
        call(
          'listAnnouncements',
          [courseId, range],
          () => announcements.get(courseId) ?? [],
          priority,
        ),
      listGroups: () => call('listGroups', [], () => scenario.groups, priority),
      getColors: () => call('getColors', [], () => scenario.colors, priority),
      getDashboardPositions: () =>
        call('getDashboardPositions', [], () => scenario.dashboardPositions, priority),
      listPlannerItems: (range) =>
        call('listPlannerItems', [range], () => plannerItems(range), priority),
      listAssignmentsByIds: (courseId, ids) =>
        call(
          'listAssignmentsByIds',
          [courseId, ids],
          () => (scenario.assignments[courseId] ?? []).filter((a) => ids.includes(a.id)),
          priority,
        ),
      listUndatedAssignments: (courseId) =>
        call(
          'listUndatedAssignments',
          [courseId],
          () => scenario.undatedAssignments[courseId] ?? [],
          priority,
        ),
      listAllAssignments: (courseId) =>
        call(
          'listAllAssignments',
          [courseId],
          () => scenario.assignments[courseId] ?? [],
          priority,
        ),
      listPlannerOverrides: () =>
        call('listPlannerOverrides', [], () => [...overrides.values()], priority),
      listCustomGradeStatuses: (courseIds) =>
        call(
          'listCustomGradeStatuses',
          [courseIds],
          () =>
            Object.fromEntries(courseIds.map((id) => [id, scenario.customGradeStatuses[id] ?? []])),
          priority,
        ),
      createOverride: (input) =>
        call(
          'createOverride',
          [input],
          () => {
            const assignmentId = input.plannableType === 'assignment' ? input.plannableId : null;
            const key = itemKey(input.plannableType, input.plannableId, assignmentId);
            if (overrides.has(key)) throw canvasError('bad_request', 400);
            const override: PlannerOverride = {
              id: String(nextId++),
              plannable_type: input.plannableType,
              plannable_id: input.plannableId,
              user_id: scenario.self.id,
              assignment_id: assignmentId,
              workflow_state: 'active',
              marked_complete: input.markedComplete,
              dismissed: input.dismissed,
            };
            overrides.set(key, override);
            return override;
          },
          priority,
        ),
      updateOverride: (id, input) =>
        call(
          'updateOverride',
          [id, input],
          () => {
            const entry = [...overrides.entries()].find(([, override]) => override.id === id);
            if (entry === undefined) throw canvasError('not_found', 404);
            const updated = {
              ...entry[1],
              marked_complete: input.markedComplete,
              dismissed: input.dismissed,
            };
            overrides.set(entry[0], updated);
            return updated;
          },
          priority,
        ),
      createNote: (input) =>
        call('createNote', [input], () => saveNote(String(nextId++), input), priority),
      updateNote: (id, input) =>
        call('updateNote', [id, input], () => saveNote(id, input), priority),
      deleteNote: (id) =>
        call(
          'deleteNote',
          [id],
          () => {
            notes.set(id, null);
          },
          priority,
        ),
    };
  }

  function withPriority(priority: PrioritySource): CanvasApi {
    return { origin: scenario.origin, withPriority, ...methods(priority) };
  }

  const fake: FakeCanvas = {
    origin: scenario.origin,
    scenario,
    calls,
    callsOf: (method) =>
      calls.filter((entry) => entry.method === method).map((entry) => entry.args),
    plannerRanges: () =>
      calls
        .filter((entry) => entry.method === 'listPlannerItems')
        .map((entry) => entry.args[0] as TimeRange),
    fail(method, error, options = {}) {
      const list = failures.get(method) ?? [];
      list.push({
        error,
        remaining: options.times ?? Number.POSITIVE_INFINITY,
        firstArg: options.firstArg,
      });
      failures.set(method, list);
    },
    hold(method) {
      let release!: () => void;
      holds.set(
        method,
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      );
      return () => {
        holds.delete(method);
        release();
      };
    },
    holdIf(method, match) {
      let release!: () => void;
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      conditionalHolds.push({ method, match, wait });
      return release;
    },
    failIf(method, match, error) {
      conditionalFailures.push({ method, match, error });
    },
    setAnnouncements(courseId, topics) {
      announcements.set(courseId, topics);
    },
    resetCalls() {
      calls.length = 0;
    },
    overrides: () => [...overrides.values()],
    addOverrideElsewhere(override) {
      overrides.set(overrideKey(override), override);
    },

    withPriority,
    ...methods('normal'),
  };
  return fake;
}
