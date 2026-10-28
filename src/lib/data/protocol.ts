/**
 * Runtime messages between the surfaces and the data owner in the background.
 * See docs/design.md, decision 11.
 *
 * Surfaces never fetch Canvas. They ask the background for their state, send refresh requests
 * and actions, and learn about new data from the change marker in `storage.local`.
 */
import type { SurfaceState } from '../model/types';
import type { SurfaceKind, TaskInput } from '../ui/contract';
import type { OverrideFlags } from './patches';

/** The extension page or surface that asks. `page` is the welcome page. */
export type RequestSurface = SurfaceKind | 'page';

/** The view a surface shows. */
export interface SurfaceRequest {
  surface: RequestSurface;
  /** 0 is the current week. */
  weekOffset: number;
  /** Missing or `undefined`: no filter. `null`: the Personal ring. */
  courseFilter?: string | null;
  /** The course of a course home page, or `null`. */
  scopeCourseId: string | null;
}

/**
 * The reply to a state request. A ready reply also names the signed-in Canvas user, so a surface
 * can tell that the user changed under its Undo notice.
 */
export type StateReply = SurfaceState & { userId?: string };

/**
 * Why a surface asks for a refresh.
 * - `visible`: the surface started or became visible again.
 * - `timer`: the 5-minute timer.
 * - `midnight`: a new day started in the Canvas time zone.
 * - `retry`: the student clicked Retry.
 * - `settings`: the student changed a setting.
 */
export type RefreshReason = 'visible' | 'timer' | 'midnight' | 'retry' | 'settings';

/** The flags of one item from before an override action, so Undo can put them back. */
export interface PreviousOverride {
  key: string;
  previous: OverrideFlags;
}

export type DataAction =
  | { kind: 'setDone'; key: string; done: boolean }
  /** Skips every item in `keys`: one item, or the items of the "N older" list. */
  | { kind: 'skip'; keys: readonly string[] }
  | { kind: 'unskip'; key: string }
  /**
   * Undo of an override action. The owner ignores it when `userId` is not the signed-in user or
   * `origin` is not the saved Canvas, so a notice never writes onto the overrides of another
   * user or school.
   */
  | { kind: 'restore'; userId: string; origin: string; entries: PreviousOverride[] }
  | { kind: 'createTask'; input: TaskInput }
  | { kind: 'updateTask'; noteId: string; input: TaskInput }
  | { kind: 'deleteTask'; noteId: string }
  | { kind: 'moveTaskToToday'; noteId: string }
  /** The Undo notice of a task delete ended, so the delayed DELETE is sent now. */
  | { kind: 'sendDelete'; noteId: string }
  /** Undo of a task delete. It works until the DELETE request has started. */
  | { kind: 'cancelDelete'; noteId: string }
  /** Leaves the address form or a check of a new address, and goes back to the saved address. */
  | { kind: 'keepSavedAddress' };

type DataActionKind = DataAction['kind'];

/** Asks for the state of one view. The reply is a `StateReply`. */
interface GetStateMessage {
  type: 'weekrow:get-state';
  request: SurfaceRequest;
}

/** The reply is a `RefreshReply`. */
interface RefreshMessage {
  type: 'weekrow:refresh';
  reason: RefreshReason;
  /** Retry applies to what this surface shows: the in-page list never checks a new address. */
  surface: RequestSurface;
}

/** The reply is an `ActionReply`. */
interface ActionMessage {
  type: 'weekrow:action';
  action: DataAction;
}

/**
 * Sent from an extension page after `permissions.request` resolved with a grant.
 * The background checks the address and saves it when it is Canvas. The reply is an `OkReply`.
 */
interface SetupMessage {
  type: 'weekrow:setup';
  origin: string;
  /** The student accepted the "Use this Canvas?" or "Switch to this Canvas?" offer. */
  fromOffer: boolean;
}

/**
 * Opens the address form. The saved address stays until a new one passes the check, and the
 * form offers "Keep using" as a cancel. The reply is an `OkReply`.
 */
interface ChangeAddressMessage {
  type: 'weekrow:change-address';
}

/** Content scripts cannot open extension pages, so they ask the background. */
export interface OpenPageMessage {
  type: 'weekrow:open-page';
  page: 'settings' | 'welcome';
}

/**
 * Content script to background: this `instructure.com` page is Canvas. The background saves the
 * page origin only when no address is saved yet, the sender page has that origin, and it is not
 * a test or beta host (decision 5). The reply is a `CanvasDetectedReply`.
 */
export interface CanvasDetectedMessage {
  type: 'weekrow:canvas-detected';
  origin: string;
}

/** Content script to background: a page of the saved Canvas loaded. Refreshes the planner items. */
export interface CanvasPageLoadedMessage {
  type: 'weekrow:canvas-page-loaded';
  origin: string;
}

export type DataMessage =
  | GetStateMessage
  | RefreshMessage
  | ActionMessage
  | SetupMessage
  | ChangeAddressMessage
  | OpenPageMessage
  | CanvasDetectedMessage;

export interface OkReply {
  ok: true;
}

export interface RefreshReply {
  ok: true;
  /**
   * Epoch milliseconds when a full round that the 60-second limit put off can run. A visible
   * surface then asks again with its timer, because the background can stop before then.
   */
  retryAt: number | null;
}

export interface CanvasDetectedReply {
  /** The saved address after the message. */
  origin: string | null;
}

/** What Undo needs, kept by the surface while its Undo notice shows. */
export type UndoData =
  | {
      kind: 'overrides';
      /** The signed-in user and the Canvas when the action ran. */
      userId: string;
      origin: string;
      entries: PreviousOverride[];
    }
  | { kind: 'delete'; userId: string; origin: string; noteId: string };

export interface ActionReply {
  /** Set when the action can be undone. The surface shows the Undo notice and keeps this data. */
  undo: UndoData | null;
  /** Only the reply to a task create has it: whether Canvas saved the task. */
  created?: boolean;
}

export interface CourseChoice {
  id: string;
  name: string;
}

export const OK_REPLY: OkReply = { ok: true };

type Fields = Record<string, unknown>;

function isObject(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null;
}

function hasType(value: unknown, type: string): value is Fields {
  return isObject(value) && value['type'] === type;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

const REQUEST_SURFACES: readonly string[] = ['panel', 'inpage', 'page'];
const REFRESH_REASONS: readonly string[] = ['visible', 'timer', 'midnight', 'retry', 'settings'];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;

export function isSurfaceRequest(value: unknown): value is SurfaceRequest {
  if (!isObject(value)) return false;
  const filter = value['courseFilter'];
  return (
    isString(value['surface']) &&
    REQUEST_SURFACES.includes(value['surface']) &&
    Number.isInteger(value['weekOffset']) &&
    (filter === undefined || isStringOrNull(filter)) &&
    isStringOrNull(value['scopeCourseId'])
  );
}

export function isTaskInput(value: unknown): value is TaskInput {
  if (!isObject(value)) return false;
  const time = value['time'];
  return (
    isNonEmptyString(value['title']) &&
    isString(value['date']) &&
    DATE_PATTERN.test(value['date']) &&
    (time === null || (isString(time) && TIME_PATTERN.test(time))) &&
    isStringOrNull(value['courseId']) &&
    isStringOrNull(value['details'])
  );
}

function isFlags(value: unknown): value is OverrideFlags {
  return (
    isObject(value) &&
    typeof value['markedComplete'] === 'boolean' &&
    typeof value['dismissed'] === 'boolean'
  );
}

function isPreviousOverride(value: unknown): value is PreviousOverride {
  return isObject(value) && isNonEmptyString(value['key']) && isFlags(value['previous']);
}

/** The most items one action may name. A student has far fewer in view. */
export const MAX_ACTION_KEYS = 2000;

export function isDataAction(value: unknown): value is DataAction {
  if (!isObject(value) || !isString(value['kind'])) return false;
  const kind = value['kind'] as DataActionKind;
  switch (kind) {
    case 'setDone':
      return isNonEmptyString(value['key']) && typeof value['done'] === 'boolean';
    case 'skip':
      return (
        Array.isArray(value['keys']) &&
        value['keys'].length > 0 &&
        value['keys'].length <= MAX_ACTION_KEYS &&
        value['keys'].every(isNonEmptyString)
      );
    case 'unskip':
      return isNonEmptyString(value['key']);
    case 'restore':
      return (
        isNonEmptyString(value['userId']) &&
        isNonEmptyString(value['origin']) &&
        Array.isArray(value['entries']) &&
        value['entries'].length <= MAX_ACTION_KEYS &&
        value['entries'].every(isPreviousOverride)
      );
    case 'createTask':
      return isTaskInput(value['input']);
    case 'updateTask':
      return isNonEmptyString(value['noteId']) && isTaskInput(value['input']);
    case 'deleteTask':
    case 'moveTaskToToday':
    case 'sendDelete':
    case 'cancelDelete':
      return isNonEmptyString(value['noteId']);
    case 'keepSavedAddress':
      return true;
    default:
      return false;
  }
}

export function isGetStateMessage(value: unknown): value is GetStateMessage {
  return hasType(value, 'weekrow:get-state') && isSurfaceRequest(value['request']);
}

export function isRefreshMessage(value: unknown): value is RefreshMessage {
  return (
    hasType(value, 'weekrow:refresh') &&
    isString(value['reason']) &&
    REFRESH_REASONS.includes(value['reason']) &&
    isString(value['surface']) &&
    REQUEST_SURFACES.includes(value['surface'])
  );
}

export function isActionMessage(value: unknown): value is ActionMessage {
  return hasType(value, 'weekrow:action') && isDataAction(value['action']);
}

export function isSetupMessage(value: unknown): value is SetupMessage {
  return (
    hasType(value, 'weekrow:setup') &&
    isNonEmptyString(value['origin']) &&
    typeof value['fromOffer'] === 'boolean'
  );
}

export function isChangeAddressMessage(value: unknown): value is ChangeAddressMessage {
  return hasType(value, 'weekrow:change-address');
}

export function isOpenPageMessage(value: unknown): value is OpenPageMessage {
  return (
    hasType(value, 'weekrow:open-page') &&
    (value['page'] === 'settings' || value['page'] === 'welcome')
  );
}

export function isCanvasDetectedMessage(value: unknown): value is CanvasDetectedMessage {
  return hasType(value, 'weekrow:canvas-detected') && isNonEmptyString(value['origin']);
}

export function isCanvasPageLoadedMessage(value: unknown): value is CanvasPageLoadedMessage {
  return hasType(value, 'weekrow:canvas-page-loaded') && isString(value['origin']);
}

export function isDataMessage(value: unknown): value is DataMessage {
  return (
    isGetStateMessage(value) ||
    isRefreshMessage(value) ||
    isActionMessage(value) ||
    isSetupMessage(value) ||
    isChangeAddressMessage(value) ||
    isOpenPageMessage(value) ||
    isCanvasDetectedMessage(value)
  );
}
