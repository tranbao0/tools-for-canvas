import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { Assignment } from '../../../shared/canvas/types';
import {
  emptyCache,
  sessionCacheItem,
  toAssignmentData,
  type SessionCache,
} from '../../../features/weekly-list/data/cache';
import { emptyCoverage } from '../../../features/weekly-list/data/coverage';

const ORIGIN = 'https://school.instructure.com';

function cacheWithData(): SessionCache {
  return {
    ...emptyCache(ORIGIN),
    planner: { ...emptyCoverage(), spans: [{ start: 1, end: 2, loadedAt: 3 }] },
    details: { '1': { id: '1' } as SessionCache['details'][string] },
    undated: { '101': [] },
    nextId: 7,
  };
}

beforeEach(() => fakeBrowser.reset());

describe('the stored cache', () => {
  it('keeps its heavy parts under their own keys and reads them back as one cache', async () => {
    const cache = cacheWithData();

    await sessionCacheItem.setValue(cache);

    const keys = Object.keys(await fakeBrowser.storage.session.get(null)).sort();
    expect(keys).toEqual([
      'weekrowAllAssignments',
      'weekrowCache',
      'weekrowDetails',
      'weekrowPlanner',
      'weekrowUndated',
    ]);
    expect(await sessionCacheItem.getValue()).toEqual(cache);
  });

  it('writes only the parts that changed since the last write', async () => {
    const cache = cacheWithData();
    await sessionCacheItem.setValue(cache);
    const set = vi.spyOn(browser.storage.session, 'set');

    await sessionCacheItem.setValue({
      ...cache,
      planner: emptyCoverage(),
      nextId: 8,
    });

    expect(set).toHaveBeenCalledTimes(1);
    expect(Object.keys(set.mock.calls[0]?.[0] ?? {}).sort()).toEqual([
      'weekrowCache',
      'weekrowPlanner',
    ]);
    expect((await sessionCacheItem.getValue())?.details).toEqual(cache.details);
  });

  it('removes every part', async () => {
    await sessionCacheItem.setValue(cacheWithData());

    await sessionCacheItem.setValue(null);

    expect(await fakeBrowser.storage.session.get(null)).toEqual({});
    expect(await sessionCacheItem.getValue()).toBeNull();
  });

  it('fills a missing part with an empty one', async () => {
    await sessionCacheItem.setValue(cacheWithData());
    await fakeBrowser.storage.session.remove('weekrowDetails');

    expect((await sessionCacheItem.getValue())?.details).toEqual({});
  });
});

describe('toAssignmentData', () => {
  it('keeps only the fields that the model and the data layer read', () => {
    const canvas = {
      id: '5',
      name: 'Lab 7',
      course_id: '101',
      due_at: '2026-10-28T03:59:59Z',
      lock_at: null,
      unlock_at: null,
      points_possible: 10,
      submission_types: ['external_tool'],
      is_quiz_lti_assignment: false,
      locked_for_user: false,
      html_url: 'https://school.instructure.com/courses/101/assignments/5',
      published: true,
      description: `<p>${'Long instructions. '.repeat(500)}</p>`,
      rubric: [{ id: 'r1', points: 10, description: 'Quality' }],
      external_tool_tag_attributes: {
        url: 'https://www.gradescope.com/auth/lti',
        new_tab: true,
        resource_link_id: 'abc',
      },
      submission: {
        id: '900',
        assignment_id: '5',
        submitted_at: null,
        workflow_state: 'unsubmitted',
        excused: null,
        missing: true,
        late: false,
        late_policy_status: 'missing',
        custom_grade_status_id: null,
        redo_request: false,
        cached_due_date: '2026-10-28T03:59:59Z',
        score: null,
        grade: null,
        body: 'A long text entry. '.repeat(500),
        preview_url: 'https://school.instructure.com/preview',
        attachments: [{ id: 'f1', url: 'https://files.example/f1' }],
      },
    } as unknown as Assignment;

    expect(toAssignmentData(canvas)).toEqual({
      id: '5',
      name: 'Lab 7',
      course_id: '101',
      due_at: '2026-10-28T03:59:59Z',
      lock_at: null,
      unlock_at: null,
      submission_types: ['external_tool'],
      is_quiz_lti_assignment: false,
      html_url: 'https://school.instructure.com/courses/101/assignments/5',
      external_tool_tag_attributes: { url: 'https://www.gradescope.com/auth/lti' },
      submission: {
        submitted_at: null,
        workflow_state: 'unsubmitted',
        excused: null,
        missing: true,
        late_policy_status: 'missing',
        custom_grade_status_id: null,
        redo_request: false,
        cached_due_date: '2026-10-28T03:59:59Z',
        score: null,
      },
    });
  });

  it('leaves absent optional fields absent', () => {
    const data = toAssignmentData({
      id: '6',
      name: 'Reading',
      course_id: '101',
      due_at: null,
      lock_at: null,
      unlock_at: null,
      submission_types: ['none'],
      html_url: '/courses/101/assignments/6',
      external_tool_tag_attributes: null,
    });
    expect(Object.keys(data).sort()).toEqual(
      [
        'id',
        'name',
        'course_id',
        'due_at',
        'lock_at',
        'unlock_at',
        'submission_types',
        'html_url',
        'external_tool_tag_attributes',
      ].sort(),
    );
    expect(data.external_tool_tag_attributes).toBeNull();
  });
});
