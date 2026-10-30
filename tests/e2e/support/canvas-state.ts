import type { PlannerItem, PlannerNote, PlannerOverride } from '../../../src/shared/canvas/types';
import { ANNOUNCEMENTS } from '../../fixtures/announcements';
import { notePlannerItem, type FixtureContext } from '../../fixtures/canvas-json';
import { CANVAS_ERRORS, type CanvasErrorFixture } from '../../fixtures/errors';
import {
  IDS,
  allAssignmentsInCourse,
  plannerItemKey,
  type Scenario,
} from '../../fixtures/scenario';
import { compareInstants } from '../../fixtures/time';
import type { FakeCanvas, FakeCanvasRoute, FakeReply, RecordedRequest } from './fake-canvas';
import { apiRoutes, json } from './scenario-api';

/** A Canvas error fixture as a fake reply. */
export function errorReply(error: CanvasErrorFixture, extraHeaders: Record<string, string> = {}) {
  const contentType = error.body.startsWith('{')
    ? 'application/json; charset=utf-8'
    : error.body.startsWith('<')
      ? 'text/html; charset=utf-8'
      : 'text/plain; charset=utf-8';
  return { status: error.status, contentType, headers: extraHeaders, body: error.body };
}

function jsonBody(request: RecordedRequest): Record<string, unknown> {
  return request.postData === null ? {} : (JSON.parse(request.postData) as Record<string, unknown>);
}

/** The course id and the topic id of a `/api/v1/courses/:id/discussion_topics/:id...` request. */
function topicIds(request: RecordedRequest): [string, string] {
  const parts = new URL(request.url).pathname.split('/');
  return [parts[4] ?? '', parts[6] ?? ''];
}

function lastPathPart(request: RecordedRequest): string {
  return new URL(request.url).pathname.split('/').at(-1) ?? '';
}

/** The assignment a planner row stands for: its own id, or the id of its graded quiz or discussion. */
function rowAssignmentId(row: PlannerItem): string | null {
  if (row.plannable_type === 'assignment') return row.plannable_id;
  const id = row.plannable.assignment_id;
  return typeof id === 'string' ? id : null;
}

/** Whether an override belongs to a planner row, as Canvas matches them. */
function overrideMatchesRow(override: PlannerOverride, row: PlannerItem): boolean {
  const assignmentId = rowAssignmentId(row);
  if (override.assignment_id !== null && assignmentId !== null) {
    return override.assignment_id === assignmentId;
  }
  return (
    override.plannable_type === row.plannable_type && override.plannable_id === row.plannable_id
  );
}

interface NoteRecord {
  note: PlannerNote;
  deleted: boolean;
}

export interface WriteRecord {
  method: string;
  path: string;
  body: Record<string, unknown>;
  /** When the request reached the fake, in epoch milliseconds of the test runner. */
  at: number;
}

/**
 * The student's Canvas with state: overrides and custom tasks change when the extension writes
 * them, and the planner and the override list then answer with the changes, as Canvas does.
 *
 * - A second POST for an item that already has an override answers 400, as Canvas does.
 * - A PUT sets both flags, and an omitted flag becomes false, as Canvas does.
 * - `plannerReply` makes the planner answer with an error, for example a 500.
 * - `limited` turns on "Limited Access for Students": the planner and planner notes answer 403,
 *   and the all-assignments request answers with every assignment of the course.
 * - `plannerPageSize` makes the planner answer as Canvas does: only the rows of the requested
 *   range, in pages with a `Link: rel="next"` header.
 */
export class CanvasState {
  readonly scenario: Scenario;
  /** When set, `GET /api/v1/planner/items` answers with this reply. */
  plannerReply: FakeReply | null = null;
  limited = false;
  /**
   * The most rows one planner page holds. `null` answers every row of the term on one page,
   * whatever the range: the extension places items by their own dates and drops the rest.
   */
  plannerPageSize: number | null = null;
  /**
   * Called for every planner request before it is answered. A test returns a promise to hold the
   * answer back, for example to keep the later days of a long span loading.
   */
  plannerGate: ((request: RecordedRequest) => Promise<void> | undefined) | null = null;
  /** The announcements the student has read, as `courseId:topicId`. */
  readonly readAnnouncements = new Set<string>(
    ANNOUNCEMENTS.filter((topic) => topic.read).map((topic) => `${topic.courseId}:${topic.id}`),
  );
  private readonly overrides = new Map<string, PlannerOverride>();
  private readonly notes = new Map<string, NoteRecord>();
  private nextOverrideId = 99001;
  private nextNoteId = 8901;

  constructor(scenario: Scenario) {
    this.scenario = scenario;
    for (const override of scenario.plannerOverrides) {
      this.overrides.set(override.id, structuredClone(override));
    }
    for (const note of scenario.plannerNotes) {
      this.notes.set(note.id, { note: structuredClone(note), deleted: false });
    }
  }

  /** The current override of a planner row, by the row's type and id. */
  overrideFor(plannableType: string, plannableId: string): PlannerOverride | null {
    const row = this.scenario.plannerItems.find(
      (item) => item.plannable_type === plannableType && item.plannable_id === plannableId,
    );
    if (row === undefined) return null;
    return (
      [...this.overrides.values()].find((override) => overrideMatchesRow(override, row)) ?? null
    );
  }

  /** The custom task with this id, or `null`. Deleted tasks are included, with their state. */
  note(id: string): NoteRecord | null {
    return this.notes.get(id) ?? null;
  }

  /** Every planner row, with the current overrides and custom tasks, ordered by date. */
  plannerItems(): PlannerItem[] {
    const overrides = [...this.overrides.values()];
    const embed = (row: PlannerItem): PlannerItem => {
      const match = overrides.find((override) => overrideMatchesRow(override, row));
      return { ...row, planner_override: match === undefined ? null : { ...match } };
    };
    const rows = this.scenario.plannerItems
      .filter((row) => row.plannable_type !== 'planner_note')
      .map(embed);
    const notes = [...this.notes.values()]
      .filter((record) => !record.deleted)
      .map((record) => embed(this.noteRow(record.note)));
    return [...rows, ...notes].sort((a, b) =>
      a.plannable_date < b.plannable_date ? -1 : a.plannable_date > b.plannable_date ? 1 : 0,
    );
  }

  /** The dynamic routes, then the static scenario API. Put page routes before these. */
  routes(): FakeCanvasRoute[] {
    const courseIds = this.scenario.courses.map((course) => course.id);
    return [
      {
        path: '/api/v1/planner/items',
        respond: async (request) => {
          await this.plannerGate?.(request);
          if (this.limited) return errorReply(CANVAS_ERRORS.limitedAccess);
          if (this.plannerReply !== null) return this.plannerReply;
          return this.plannerPageSize === null
            ? { body: json(this.plannerItems()) }
            : this.plannerPage(request, this.plannerPageSize);
        },
      },
      {
        path: '/api/v1/planner/overrides',
        respond: () => ({ body: json([...this.overrides.values()]) }),
      },
      {
        method: 'POST',
        path: '/api/v1/planner/overrides',
        respond: (request) => this.createOverride(jsonBody(request)),
      },
      {
        method: 'PUT',
        path: /^\/api\/v1\/planner\/overrides\/\d+$/,
        respond: (request) => this.updateOverride(lastPathPart(request), jsonBody(request)),
      },
      {
        method: 'POST',
        path: '/api/v1/planner_notes',
        respond: (request) => this.createNote(jsonBody(request)),
      },
      {
        method: 'PUT',
        path: /^\/api\/v1\/planner_notes\/\d+$/,
        respond: (request) => this.updateNote(lastPathPart(request), jsonBody(request)),
      },
      {
        method: 'DELETE',
        path: /^\/api\/v1\/planner_notes\/\d+$/,
        respond: (request) => this.deleteNote(lastPathPart(request)),
      },
      {
        path: '/api/v1/announcements',
        respond: (request) => this.announcementPage(request),
      },
      {
        path: /^\/api\/v1\/courses\/\d+\/discussion_topics\/\d+$/,
        respond: (request) => {
          const [courseId, topicId] = topicIds(request);
          const topic = ANNOUNCEMENTS.find((t) => t.courseId === courseId && t.id === topicId);
          return topic === undefined
            ? errorReply(CANVAS_ERRORS.notFound)
            : { body: json(this.topicJson(topic)) };
        },
      },
      {
        method: 'PUT',
        path: /^\/api\/v1\/courses\/\d+\/discussion_topics\/\d+\/read$/,
        respond: (request) => {
          const [courseId, topicId] = topicIds(request);
          this.readAnnouncements.add(`${courseId}:${topicId}`);
          // Canvas answers 204 with no body.
          return { status: 204 };
        },
      },
      {
        method: 'DELETE',
        path: /^\/api\/v1\/courses\/\d+\/discussion_topics\/\d+\/read$/,
        respond: (request) => {
          const [courseId, topicId] = topicIds(request);
          this.readAnnouncements.delete(`${courseId}:${topicId}`);
          return { status: 204 };
        },
      },
      ...courseIds.map((id): FakeCanvasRoute => ({
        // The all-assignments request of the planner-off list: no ids and no bucket.
        path: new RegExp(`^/api/v1/courses/${id}/assignments\\?(?!.*assignment_ids)(?!.*bucket=)`),
        respond: () => ({ body: json(allAssignmentsInCourse(this.scenario, id)) }),
      })),
      ...courseIds.map((id): FakeCanvasRoute => ({
        // The assignment details request answers only the ids it asks for, as Canvas does.
        path: new RegExp(`^/api/v1/courses/${id}/assignments\\?.*assignment_ids`),
        respond: (request) => {
          const ids = new URL(request.url).searchParams.getAll('assignment_ids[]');
          const list = (this.scenario.assignments[id] ?? []).filter((a) => ids.includes(a.id));
          return { body: json(list) };
        },
      })),
      ...apiRoutes(this.scenario),
    ];
  }

  /**
   * The announcements list as Canvas answers it: only the courses of `context_codes[]`, only the
   * posts from `start_date` to `end_date` (the 14 days before today and 28 days after the start
   * without dates), newest first, in pages of `per_page` with a `Link: rel="next"` header. The
   * fixtures are all published, so `active_only` changes nothing here.
   */
  private announcementPage(request: RecordedRequest): FakeReply {
    const url = new URL(request.url);
    const codes = url.searchParams.getAll('context_codes[]');
    if (codes.length === 0) return { status: 400, body: { message: 'Missing context_codes' } };
    const day = 24 * 60 * 60 * 1000;
    const startParam = url.searchParams.get('start_date');
    const endParam = url.searchParams.get('end_date');
    const start =
      startParam === null ? Date.parse(this.scenario.now) - 14 * day : Date.parse(startParam);
    const end = endParam === null ? start + 28 * day : Date.parse(endParam);
    const rows = ANNOUNCEMENTS.filter(
      (topic) =>
        codes.includes(`course_${topic.courseId}`) &&
        Date.parse(topic.posted_at ?? '') >= start &&
        Date.parse(topic.posted_at ?? '') <= end,
    ).sort((a, b) => Date.parse(b.posted_at ?? '') - Date.parse(a.posted_at ?? ''));
    const perPage = Math.max(1, Number(url.searchParams.get('per_page') ?? '10') || 10);
    const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);
    const pageRows = rows.slice((page - 1) * perPage, page * perPage);
    const pageUrl = (number: number): string => {
      const next = new URL(url);
      next.searchParams.set('page', String(number));
      return next.href;
    };
    const links = [`<${pageUrl(page)}>; rel="current"`, `<${pageUrl(1)}>; rel="first"`];
    if (page * perPage < rows.length) links.unshift(`<${pageUrl(page + 1)}>; rel="next"`);
    return {
      body: json(pageRows.map((topic) => this.topicJson(topic))),
      headers: { link: links.join(',') },
    };
  }

  private topicJson(topic: (typeof ANNOUNCEMENTS)[number]): unknown {
    return {
      id: topic.id,
      title: topic.title,
      message: topic.message,
      posted_at: topic.posted_at,
      user_name: topic.user_name,
      author: { display_name: topic.user_name },
      context_code: `course_${topic.courseId}`,
      read_state: this.readAnnouncements.has(`${topic.courseId}:${topic.id}`) ? 'read' : 'unread',
    };
  }

  /**
   * One page of the rows whose range date is inside `start_date` to `end_date`, both ends
   * included. Older-style peer reviews match on the reviewer's own due date, as in Canvas.
   */
  private plannerPage(request: RecordedRequest, pageSize: number): FakeReply {
    const url = new URL(request.url);
    const start = url.searchParams.get('start_date');
    const end = url.searchParams.get('end_date');
    const perPage = Math.min(Number(url.searchParams.get('per_page') ?? '10') || 10, pageSize);
    const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);
    const rows = this.plannerItems().filter((row) => {
      const date = this.scenario.plannerRangeDates[plannerItemKey(row)] ?? row.plannable_date;
      return (
        (start === null || compareInstants(start, date) <= 0) &&
        (end === null || compareInstants(date, end) <= 0)
      );
    });
    const pageRows = rows.slice((page - 1) * perPage, page * perPage);
    const pageUrl = (number: number): string => {
      const next = new URL(url);
      next.searchParams.set('page', String(number));
      return next.href;
    };
    const links = [`<${pageUrl(page)}>; rel="current"`, `<${pageUrl(1)}>; rel="first"`];
    if (page * perPage < rows.length) links.unshift(`<${pageUrl(page + 1)}>; rel="next"`);
    return { body: json(pageRows), headers: { link: links.join(',') } };
  }

  private fixtureContext(): FixtureContext {
    return {
      origin: this.scenario.origin,
      now: this.scenario.now,
      timeZone: this.scenario.timeZone,
      userId: IDS.user,
      userName: this.scenario.self.name,
    };
  }

  private noteRow(note: PlannerNote): PlannerItem {
    const course =
      note.course_id === null
        ? null
        : (this.scenario.courses.find((candidate) => candidate.id === note.course_id) ?? null);
    return notePlannerItem(this.fixtureContext(), {
      id: note.id,
      title: note.title,
      details: note.details,
      todoDate: note.todo_date,
      course: course === null ? null : { id: course.id, contextName: course.name },
      createdAt: note.created_at,
    });
  }

  private createOverride(body: Record<string, unknown>): FakeReply {
    const plannableType = String(body['plannable_type']);
    const plannableId = String(body['plannable_id']);
    const assignmentId = plannableType === 'assignment' ? plannableId : null;
    const taken = [...this.overrides.values()].some(
      (override) =>
        (assignmentId !== null && override.assignment_id === assignmentId) ||
        (override.plannable_type === plannableType && override.plannable_id === plannableId),
    );
    if (taken) return errorReply(CANVAS_ERRORS.overrideExists);
    const id = String(this.nextOverrideId++);
    const override: PlannerOverride = {
      id,
      plannable_type: plannableType,
      plannable_id: plannableId,
      user_id: IDS.user,
      workflow_state: 'active',
      marked_complete: body['marked_complete'] === true,
      dismissed: body['dismissed'] === true,
      assignment_id: assignmentId,
    };
    this.overrides.set(id, override);
    return { body: json(override) };
  }

  private updateOverride(id: string, body: Record<string, unknown>): FakeReply {
    const current = this.overrides.get(id);
    if (current === undefined) return errorReply(CANVAS_ERRORS.notFound);
    const updated: PlannerOverride = {
      ...current,
      marked_complete: body['marked_complete'] === true,
      dismissed: body['dismissed'] === true,
    };
    this.overrides.set(id, updated);
    return { body: json(updated) };
  }

  private createNote(body: Record<string, unknown>): FakeReply {
    if (this.limited) return errorReply(CANVAS_ERRORS.limitedAccess);
    if (typeof body['todo_date'] !== 'string') {
      return { status: 400, body: { errors: { todo_date: [{ message: 'blank' }] } } };
    }
    const id = String(this.nextNoteId++);
    const note: PlannerNote = {
      id,
      todo_date: body['todo_date'],
      title: String(body['title']),
      details: typeof body['details'] === 'string' ? body['details'] : null,
      user_id: IDS.user,
      course_id: typeof body['course_id'] === 'string' ? body['course_id'] : null,
      workflow_state: 'active',
      created_at: this.scenario.now,
      updated_at: this.scenario.now,
    };
    this.notes.set(id, { note, deleted: false });
    return { body: json(note) };
  }

  private updateNote(id: string, body: Record<string, unknown>): FakeReply {
    if (this.limited) return errorReply(CANVAS_ERRORS.limitedAccess);
    const record = this.notes.get(id);
    if (record === undefined || record.deleted) return errorReply(CANVAS_ERRORS.notFound);
    const note: PlannerNote = { ...record.note, updated_at: this.scenario.now };
    if ('title' in body) note.title = String(body['title']);
    if ('details' in body)
      note.details = typeof body['details'] === 'string' ? body['details'] : null;
    if ('todo_date' in body) note.todo_date = String(body['todo_date']);
    if ('course_id' in body) {
      note.course_id = typeof body['course_id'] === 'string' ? body['course_id'] : null;
    }
    this.notes.set(id, { note, deleted: false });
    return { body: json(note) };
  }

  private deleteNote(id: string): FakeReply {
    if (this.limited) return errorReply(CANVAS_ERRORS.limitedAccess);
    const record = this.notes.get(id);
    if (record === undefined || record.deleted) return errorReply(CANVAS_ERRORS.notFound);
    this.notes.set(id, { note: record.note, deleted: true });
    return { body: json({ ...record.note, workflow_state: 'deleted' }) };
  }
}

/** The JSON bodies of the requests with this method whose path starts with `prefix`, in order. */
export function writesTo(canvas: FakeCanvas, method: string, prefix: string): WriteRecord[] {
  return canvas.requests
    .filter((request) => request.method === method && request.path.startsWith(prefix))
    .map((request) => ({
      method: request.method,
      path: request.path,
      body: jsonBody(request),
      at: request.at,
    }));
}

/** Every override write (POST and PUT), in order. */
export function overrideWrites(canvas: FakeCanvas): WriteRecord[] {
  return canvas.requests
    .filter(
      (request) =>
        request.path.startsWith('/api/v1/planner/overrides') &&
        (request.method === 'POST' || request.method === 'PUT'),
    )
    .map((request) => ({
      method: request.method,
      path: request.path,
      body: jsonBody(request),
      at: request.at,
    }));
}
