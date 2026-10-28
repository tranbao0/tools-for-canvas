/**
 * The memory-only cache of Canvas data. See docs/design.md, decision 11.
 *
 * The cache lives in `storage.session`: the browser keeps it in memory, never writes it to
 * disk, and it survives a service worker restart. It holds the data of one Canvas origin.
 */
import type {
  CanvasErrorKind,
  Colors,
  Course,
  CustomGradeStatus,
  DashboardPositions,
  Group,
  PlannerOverride,
  Profile,
} from '../canvas/types';
import type { AssignmentData, SubmissionData, UndoInfo } from '../model/types';
import { browser } from 'wxt/browser';
import { defineItem } from '../platform/storage';
import { emptyCoverage, type PlannerCoverage } from './coverage';
import type { OverrideFlags, OverrideTarget, Patch } from './patches';

export const CACHE_VERSION = 5;

/** Data that loads once per browser session. */
export interface SessionData {
  profile: Profile;
  courses: Course[];
  groups: Group[];
  colors: Colors;
  positions: DashboardPositions;
}

/** What failed: a refresh round, or a write of the student. */
export type FailureSource = 'round' | 'write';

export type Failure =
  /** Any 401, then `GET /api/v1/users/self` also returned 401. */
  | { kind: 'signed_out' }
  /**
   * A refresh or a write failed with a "Can't refresh" cause. The cause is kept for logs and
   * retries. A write failure does not stop the loads a view needs.
   */
  | {
      kind: 'stale';
      offline: boolean;
      cause: CanvasErrorKind | 'unknown';
      at: number;
      source: FailureSource;
    };

export type RoundScope = 'light' | 'full';

/** The facts the 60-second refresh limit needs. */
export interface RoundLimits {
  /** Epoch milliseconds when the last light or full round started. */
  lastRoundAt: number | null;
  lastRoundScope: RoundScope | null;
  /** Epoch milliseconds when the last full round started. */
  lastFullAt: number | null;
}

/** One item of an undoable override write, with its flags from before the write. */
export interface UndoEntry {
  key: string;
  target: OverrideTarget;
  previous: OverrideFlags;
}

export type UndoRecord =
  | { kind: 'overrides'; entries: UndoEntry[] }
  /**
   * A delayed task delete. The DELETE is sent when the Undo notice ends, and at the latest
   * when its patch's `deleteAt` comes. Undo drops the patch before the DELETE starts.
   */
  | { kind: 'delete'; patchId: number };

/**
 * An undo record. It has no time limit: it stays until its Undo notice ends, so keyboard and
 * screen reader users have the time they need (decision 6).
 */
export interface StoredUndo {
  record: UndoRecord;
  /** What the Undo notice says. A ready state reports it while the notice still applies. */
  info: UndoInfo;
  /** Epoch milliseconds when the action ran. The oldest records go first past the cap. */
  createdAt: number;
}

export interface SessionCache {
  version: typeof CACHE_VERSION;
  origin: string;
  session: SessionData | null;
  /** The planner items, merged from every load, and the spans they are complete for. */
  planner: PlannerCoverage;
  /** Assignment details keyed by assignment id. Hand-in types rarely change, so they stay all session. */
  details: Record<string, AssignmentData>;
  /** Undated work keyed by course id. A missing key means the course was never loaded. */
  undated: Record<string, AssignmentData[]>;
  /** `null` until the override list loads. */
  overrides: PlannerOverride[] | null;
  /** Teacher status names keyed by course id. Loaded once per course per session. */
  gradeStatuses: Record<string, CustomGradeStatus[]>;
  /** The Canvas planner is turned off for the student (Limited Access for Students). */
  limited: boolean;
  /** Limited mode only: all assignments keyed by course id. */
  allAssignments: Record<string, AssignmentData[]>;
  /**
   * Requests that failed for one course only, such as `details:<assignment id>` or
   * `undated:<course id>`. They are not tried again until the next refresh round.
   */
  skipped: string[];
  /** Courses whose requests failed in the last round. The list shows a short note for them. */
  failedCourses: string[];
  /** Epoch milliseconds of the last successful round. */
  lastSuccessAt: number | null;
  failure: Failure | null;
  limits: RoundLimits;
  /** Writes applied on top of the Canvas data until a later round confirms them. */
  patches: Patch[];
  /**
   * Undo records by token. They live here, in `storage.session`, so an Undo click still works
   * after a service worker restart.
   */
  undos: Record<string, StoredUndo>;
  /** Real ids of custom tasks that were created, keyed by their temporary id. */
  noteIds: Record<string, string>;
  /** The next id for patches, temporary note ids and undo tokens. */
  nextId: number;
}

/** Copies the fields that are set, so an absent optional field stays absent. */
function pick<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Pick<T, K> {
  const result: Partial<Pick<T, K>> = {};
  for (const key of keys) {
    if (source[key] !== undefined) result[key] = source[key];
  }
  return result as Pick<T, K>;
}

const SUBMISSION_FIELDS = [
  'submitted_at',
  'workflow_state',
  'excused',
  'missing',
  'late_policy_status',
  'custom_grade_status_id',
  'redo_request',
  'cached_due_date',
  'score',
] as const satisfies readonly (keyof SubmissionData)[];

const ASSIGNMENT_FIELDS = [
  'id',
  'name',
  'course_id',
  'due_at',
  'lock_at',
  'unlock_at',
  'points_possible',
  'submission_types',
  'is_quiz_lti_assignment',
  'has_sub_assignments',
  'locked_for_user',
  'html_url',
] as const satisfies readonly (keyof AssignmentData)[];

/**
 * The part of a Canvas assignment that the cache keeps: the fields the model and the data layer
 * read. A real assignment carries its HTML description, its rubric and the submission's body and
 * attachments, which would soon fill `storage.session`.
 */
export function toAssignmentData(assignment: AssignmentData): AssignmentData {
  const data: AssignmentData = pick(assignment, ASSIGNMENT_FIELDS);
  const tool = assignment.external_tool_tag_attributes;
  if (tool !== undefined)
    data.external_tool_tag_attributes = tool === null ? null : { url: tool.url };
  if (assignment.submission !== undefined) {
    data.submission = pick(assignment.submission, SUBMISSION_FIELDS);
  }
  return data;
}

export function emptyCache(origin: string): SessionCache {
  return {
    version: CACHE_VERSION,
    origin,
    session: null,
    planner: emptyCoverage(),
    details: {},
    undated: {},
    overrides: null,
    gradeStatuses: {},
    limited: false,
    allAssignments: {},
    skipped: [],
    failedCourses: [],
    lastSuccessAt: null,
    failure: null,
    limits: { lastRoundAt: null, lastRoundScope: null, lastFullAt: null },
    patches: [],
    undos: {},
    noteIds: {},
    nextId: 1,
  };
}

/** Whether a stored value is a cache this version can read. */
export function isSessionCache(value: unknown): value is SessionCache {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { version?: unknown }).version === CACHE_VERSION &&
    typeof (value as { origin?: unknown }).origin === 'string'
  );
}

/**
 * The address form, a setup check in progress, or its result. Every `origin` here passed
 * `normalizeAddress`, so only a usable https origin is ever checked again.
 */
export type SetupStatus =
  /** The student opened the address form. The saved address stays until a new one passes. */
  | { kind: 'entering' }
  | { kind: 'checking'; origin: string }
  | { kind: 'redirects'; origin: string }
  | { kind: 'not_canvas'; origin: string }
  /** The check failed at the network level, such as a wrong host name. Retry checks again. */
  | { kind: 'unreachable'; origin: string }
  /** The typed text is not a usable address. It is kept for display only, never checked. */
  | { kind: 'rejected'; text: string };

/** The address a setup status is about, or `null` when it has none to check. */
export function setupStatusOrigin(status: SetupStatus | null): string | null {
  if (status === null) return null;
  switch (status.kind) {
    case 'entering':
    case 'rejected':
      return null;
    case 'checking':
    case 'redirects':
    case 'not_canvas':
    case 'unreachable':
      return status.origin;
  }
}

/** Whether a stored value is a setup status this version can read. */
export function isSetupStatus(value: unknown): value is SetupStatus {
  if (typeof value !== 'object' || value === null) return false;
  const fields = value as { kind?: unknown; origin?: unknown; text?: unknown };
  switch (fields.kind) {
    case 'entering':
      return true;
    case 'rejected':
      return typeof fields.text === 'string';
    case 'checking':
    case 'redirects':
    case 'not_canvas':
    case 'unreachable':
      return typeof fields.origin === 'string';
    default:
      return false;
  }
}

/** The parts of the cache that weigh most, each under its own key in `storage.session`. */
const PART_KEYS = {
  planner: 'weekrowPlanner',
  details: 'weekrowDetails',
  undated: 'weekrowUndated',
  allAssignments: 'weekrowAllAssignments',
} as const satisfies Partial<Record<keyof SessionCache, string>>;

type CachePart = keyof typeof PART_KEYS;

/** The key of everything else: versions, session data, limits, patches and undo records. */
const HEAD_KEY = 'weekrowCache';

const PARTS = Object.keys(PART_KEYS) as CachePart[];

function emptyPart(part: CachePart): unknown {
  return part === 'planner' ? emptyCoverage() : {};
}

/**
 * The cache in `storage.session`. Its heavy parts live under their own keys, and a write sends
 * only the parts that changed since the last write, so a new week's planner items do not write
 * every assignment detail again, and the change events that reach each extension page stay small.
 * Parts are compared by reference: the data owner replaces a part whenever it changes it.
 */
function createSessionCacheItem() {
  const area = () => browser.storage.session;
  let written = new Map<CachePart, unknown>();

  return {
    async getValue(): Promise<SessionCache | null> {
      const stored: Record<string, unknown> = await area().get([
        HEAD_KEY,
        ...Object.values(PART_KEYS),
      ]);
      const head = stored[HEAD_KEY];
      written = new Map();
      if (typeof head !== 'object' || head === null) return null;
      const value: Record<string, unknown> = { ...head };
      for (const part of PARTS) {
        const content = stored[PART_KEYS[part]] ?? emptyPart(part);
        value[part] = content;
        written.set(part, content);
      }
      return value as unknown as SessionCache;
    },

    async setValue(value: SessionCache | null): Promise<void> {
      if (value === null) {
        written = new Map();
        await area().remove([HEAD_KEY, ...Object.values(PART_KEYS)]);
        return;
      }
      const { planner, details, undated, allAssignments, ...head } = value;
      const parts: Record<CachePart, unknown> = { planner, details, undated, allAssignments };
      const changes: Record<string, unknown> = { [HEAD_KEY]: head };
      const sent = PARTS.filter((part) => written.get(part) !== parts[part]);
      for (const part of sent) changes[PART_KEYS[part]] = parts[part];
      await area().set(changes);
      for (const part of sent) written.set(part, parts[part]);
    },
  };
}

/** The cache item in `storage.session`. */
export const sessionCacheItem = createSessionCacheItem();

/** The setup status item in `storage.session`, so a service worker restart keeps it. */
export const setupStatusItem = defineItem<SetupStatus | null>('session:weekrowSetup', () => null);
