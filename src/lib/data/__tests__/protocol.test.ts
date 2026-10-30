import { describe, expect, it } from 'vitest';
import { isSettings } from '../../../features/weekly-list/model/settings';
import {
  isAcceptOfferMessage,
  isActionMessage,
  isCanvasDetectedMessage,
  isDataAction,
  isDataMessage,
  isGetStateMessage,
  isMarkNoteSeenMessage,
  isPageChangedMessage,
  isPageContextMessage,
  isSaveSettingsMessage,
  isOpenPageMessage,
  isRefreshMessage,
  isSurfaceRequest,
  isTaskInput,
  type DataAction,
} from '../../../features/weekly-list/data/protocol';

const REQUEST = { surface: 'panel', spanOffset: 0, scopeCourseId: null };
const TASK = { title: 'Read', date: '2026-10-29', time: '09:30', courseId: '101', details: null };

describe('surface requests', () => {
  it('accepts a request with or without a course filter', () => {
    expect(isSurfaceRequest(REQUEST)).toBe(true);
    expect(isSurfaceRequest({ ...REQUEST, courseFilter: '101' })).toBe(true);
    expect(isSurfaceRequest({ ...REQUEST, courseFilter: null })).toBe(true);
    expect(isSurfaceRequest({ ...REQUEST, courseFilter: undefined })).toBe(true);
    expect(
      isSurfaceRequest({ ...REQUEST, surface: 'page', spanOffset: -3, scopeCourseId: '7' }),
    ).toBe(true);
  });

  it.each([
    { ...REQUEST, surface: 'popup' },
    { ...REQUEST, spanOffset: 0.5 },
    { ...REQUEST, spanOffset: '1' },
    { ...REQUEST, courseFilter: 101 },
    { surface: 'panel', spanOffset: 0 },
    null,
  ])('rejects %j', (value) => {
    expect(isSurfaceRequest(value)).toBe(false);
  });
});

describe('task input', () => {
  it('accepts a full and an empty time', () => {
    expect(isTaskInput(TASK)).toBe(true);
    expect(isTaskInput({ ...TASK, time: null, courseId: null, details: 'x' })).toBe(true);
  });

  it.each([
    { ...TASK, title: '' },
    { ...TASK, date: '10/29/2026' },
    { ...TASK, time: '9:30' },
    { ...TASK, details: undefined },
  ])('rejects %j', (value) => {
    expect(isTaskInput(value)).toBe(false);
  });
});

describe('actions', () => {
  const valid: DataAction[] = [
    { kind: 'setDone', key: 'assignment:1', done: true },
    { kind: 'skip', keys: ['assignment:1'] },
    { kind: 'skip', keys: ['assignment:1', 'planner_note:4'] },
    { kind: 'unskip', key: 'assignment:1' },
    {
      kind: 'restore',
      userId: '9',
      origin: 'https://a.edu',
      entries: [{ key: 'assignment:1', previous: { markedComplete: false, dismissed: true } }],
    },
    { kind: 'createTask', input: TASK },
    { kind: 'updateTask', noteId: '8', input: TASK },
    { kind: 'deleteTask', noteId: '8' },
    { kind: 'moveTaskToToday', noteId: '8' },
    { kind: 'sendDelete', noteId: '8' },
    { kind: 'cancelDelete', noteId: '8' },
  ];

  it.each(valid)('accepts $kind', (action) => {
    expect(isDataAction(action)).toBe(true);
    expect(isActionMessage({ type: 'weekrow:action', action })).toBe(true);
  });

  it.each([
    { kind: 'setDone', key: 'assignment:1' },
    { kind: 'setDone', key: '', done: true },
    { kind: 'skip', key: 'assignment:1' },
    { kind: 'skip', keys: [] },
    { kind: 'skip', keys: Array.from({ length: 2001 }, (_, index) => `assignment:${index}`) },
    { kind: 'skip', keys: ['assignment:1', ''] },
    { kind: 'restore', userId: '', origin: 'https://a.edu', entries: [] },
    { kind: 'restore', userId: '9', origin: '', entries: [] },
    { kind: 'restore', userId: '9', entries: [] },
    { kind: 'restore', userId: '9', origin: 'https://a.edu' },
    {
      kind: 'restore',
      userId: '9',
      origin: 'https://a.edu',
      entries: [{ key: 'assignment:1', previous: { markedComplete: true } }],
    },
    { kind: 'sendDelete', noteId: '' },
    { kind: 'cancelDelete' },
    { kind: 'createTask', input: { ...TASK, title: '' } },
    { kind: 'deleteOverride', key: 'assignment:1' },
    { kind: 'keepSavedAddress' },
    { key: 'assignment:1' },
  ])('rejects %j', (action) => {
    expect(isDataAction(action)).toBe(false);
  });
});

describe('messages', () => {
  it('recognizes each message type', () => {
    expect(isGetStateMessage({ type: 'weekrow:get-state', request: REQUEST })).toBe(true);
    expect(isRefreshMessage({ type: 'weekrow:refresh', reason: 'timer' })).toBe(true);
    expect(isRefreshMessage({ type: 'weekrow:refresh' })).toBe(false);
    expect(isRefreshMessage({ type: 'weekrow:refresh', reason: 'page_loaded' })).toBe(false);
    expect(
      isCanvasDetectedMessage({ type: 'weekrow:canvas-detected', origin: 'https://a.edu' }),
    ).toBe(true);
    expect(isCanvasDetectedMessage({ type: 'weekrow:canvas-detected', origin: '' })).toBe(false);
    expect(isAcceptOfferMessage({ type: 'weekrow:accept-offer', origin: 'https://a.edu' })).toBe(
      true,
    );
    expect(isAcceptOfferMessage({ type: 'weekrow:accept-offer', origin: '' })).toBe(false);
    expect(isOpenPageMessage({ type: 'weekrow:open-page', page: 'welcome' })).toBe(true);
    expect(isOpenPageMessage({ type: 'weekrow:open-page', page: 'settings' })).toBe(false);
    expect(isOpenPageMessage({ type: 'weekrow:open-page', page: 'https://a.edu' })).toBe(false);
  });

  it('leaves the panel presence and page-load messages to others', () => {
    expect(isDataMessage({ type: 'weekrow:panel-hello', windowId: 1 })).toBe(false);
    expect(isDataMessage({ type: 'weekrow:canvas-page-loaded', origin: 'https://a.edu' })).toBe(
      false,
    );
    expect(isDataMessage({ type: 'weekrow:get-state' })).toBe(false);
    // The typed-address messages no longer exist.
    expect(
      isDataMessage({ type: 'weekrow:setup', origin: 'https://a.edu', fromOffer: false }),
    ).toBe(false);
    expect(isDataMessage({ type: 'weekrow:change-address' })).toBe(false);
    // The in-page confirmation no longer exists: only extension pages answer an offer.
    expect(isDataMessage({ type: 'weekrow:confirm-canvas' })).toBe(false);
    expect(isDataMessage('weekrow:get-state')).toBe(false);
  });
});

describe('the messages of the in-page script', () => {
  const SETTINGS = {
    span: { kind: 'month', days: 7 },
    weekStart: 'auto',
    hiddenCourseIds: ['7'],
    showRings: true,
    showOnCanvasPages: false,
    theme: 'dark',
  };

  it('accept settings of exactly the right shape', () => {
    expect(isSettings(SETTINGS)).toBe(true);
    expect(isSettings({ ...SETTINGS, weekStart: 7 })).toBe(true);
    expect(isSaveSettingsMessage({ type: 'weekrow:save-settings', settings: SETTINGS })).toBe(true);
    expect(isDataMessage({ type: 'weekrow:save-settings', settings: SETTINGS })).toBe(true);
  });

  it.each([
    [{ ...SETTINGS, extra: true }],
    [{ ...SETTINGS, span: 'week' }],
    [{ ...SETTINGS, span: { kind: 'year', days: 7 } }],
    [{ ...SETTINGS, span: { kind: 'custom', days: 1 } }],
    [{ ...SETTINGS, span: { kind: 'custom', days: 91 } }],
    [{ ...SETTINGS, span: { kind: 'custom', days: 2.5 } }],
    [{ ...SETTINGS, span: { kind: 'custom' } }],
    [{ ...SETTINGS, span: { kind: 'week', days: 7, extra: 1 } }],
    [{ ...SETTINGS, weekStart: 0 }],
    [{ ...SETTINGS, weekStart: '1' }],
    [{ ...SETTINGS, theme: 'sepia' }],
    [{ ...SETTINGS, hiddenCourseIds: 'all' }],
    [{ ...SETTINGS, hiddenCourseIds: [7] }],
    [{ ...SETTINGS, hiddenCourseIds: [''] }],
    [{ ...SETTINGS, hiddenCourseIds: ['1'.repeat(41)] }],
    [{ ...SETTINGS, hiddenCourseIds: Array.from({ length: 1001 }, (_, i) => `${i + 1}`) }],
    [{ ...SETTINGS, showRings: 1 }],
    [{ weekStart: 'auto' }],
    [null],
    ['settings'],
  ])('refuse settings of the wrong shape: %j', (value) => {
    expect(isSettings(value)).toBe(false);
    expect(isSaveSettingsMessage({ type: 'weekrow:save-settings', settings: value })).toBe(false);
  });

  it('recognize the note, context and change messages', () => {
    expect(isMarkNoteSeenMessage({ type: 'weekrow:mark-note-seen', note: 'firstDone' })).toBe(true);
    expect(isMarkNoteSeenMessage({ type: 'weekrow:mark-note-seen', note: 'firstSkip' })).toBe(true);
    expect(isMarkNoteSeenMessage({ type: 'weekrow:mark-note-seen', note: 'other' })).toBe(false);
    expect(isPageContextMessage({ type: 'weekrow:page-context' })).toBe(true);
    expect(isDataMessage({ type: 'weekrow:page-context' })).toBe(true);
    // The change message goes from the background to the page. The router is not its receiver.
    expect(isPageChangedMessage({ type: 'weekrow:changed' })).toBe(true);
    expect(isDataMessage({ type: 'weekrow:changed' })).toBe(false);
  });
});
