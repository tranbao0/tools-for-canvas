import { describe, expect, it } from 'vitest';
import {
  isActionMessage,
  isCanvasDetectedMessage,
  isChangeAddressMessage,
  isDataAction,
  isDataMessage,
  isGetStateMessage,
  isOpenPageMessage,
  isRefreshMessage,
  isSetupMessage,
  isSurfaceRequest,
  isTaskInput,
  type DataAction,
} from '../protocol';

const REQUEST = { surface: 'panel', weekOffset: 0, scopeCourseId: null };
const TASK = { title: 'Read', date: '2026-10-29', time: '09:30', courseId: '101', details: null };

describe('surface requests', () => {
  it('accepts a request with or without a course filter', () => {
    expect(isSurfaceRequest(REQUEST)).toBe(true);
    expect(isSurfaceRequest({ ...REQUEST, courseFilter: '101' })).toBe(true);
    expect(isSurfaceRequest({ ...REQUEST, courseFilter: null })).toBe(true);
    expect(isSurfaceRequest({ ...REQUEST, courseFilter: undefined })).toBe(true);
    expect(
      isSurfaceRequest({ ...REQUEST, surface: 'page', weekOffset: -3, scopeCourseId: '7' }),
    ).toBe(true);
  });

  it.each([
    { ...REQUEST, surface: 'popup' },
    { ...REQUEST, weekOffset: 0.5 },
    { ...REQUEST, weekOffset: '1' },
    { ...REQUEST, courseFilter: 101 },
    { surface: 'panel', weekOffset: 0 },
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
    { kind: 'keepSavedAddress' },
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
    { key: 'assignment:1' },
  ])('rejects %j', (action) => {
    expect(isDataAction(action)).toBe(false);
  });
});

describe('messages', () => {
  it('recognizes each message type', () => {
    expect(isGetStateMessage({ type: 'weekrow:get-state', request: REQUEST })).toBe(true);
    expect(isRefreshMessage({ type: 'weekrow:refresh', reason: 'timer', surface: 'panel' })).toBe(
      true,
    );
    expect(isRefreshMessage({ type: 'weekrow:refresh', reason: 'timer' })).toBe(false);
    expect(isRefreshMessage({ type: 'weekrow:refresh', reason: 'timer', surface: 'popup' })).toBe(
      false,
    );
    expect(
      isRefreshMessage({ type: 'weekrow:refresh', reason: 'page_loaded', surface: 'panel' }),
    ).toBe(false);
    expect(
      isCanvasDetectedMessage({ type: 'weekrow:canvas-detected', origin: 'https://a.edu' }),
    ).toBe(true);
    expect(isCanvasDetectedMessage({ type: 'weekrow:canvas-detected', origin: '' })).toBe(false);
    expect(
      isSetupMessage({ type: 'weekrow:setup', origin: 'https://a.edu', fromOffer: false }),
    ).toBe(true);
    expect(isSetupMessage({ type: 'weekrow:setup', origin: '', fromOffer: false })).toBe(false);
    expect(isChangeAddressMessage({ type: 'weekrow:change-address' })).toBe(true);
    expect(isOpenPageMessage({ type: 'weekrow:open-page', page: 'welcome' })).toBe(true);
    expect(isOpenPageMessage({ type: 'weekrow:open-page', page: 'https://a.edu' })).toBe(false);
  });

  it('leaves the panel presence and page-load messages to others', () => {
    expect(isDataMessage({ type: 'weekrow:panel-hello', windowId: 1 })).toBe(false);
    expect(isDataMessage({ type: 'weekrow:canvas-page-loaded', origin: 'https://a.edu' })).toBe(
      false,
    );
    expect(isDataMessage({ type: 'weekrow:get-state' })).toBe(false);
    expect(isDataMessage('weekrow:get-state')).toBe(false);
  });
});
