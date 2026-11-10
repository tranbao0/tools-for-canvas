import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDS } from '../../../../tests/fixtures/scenario';
import { rawRecords } from '../../../../tests/fixtures/assignment-view';
import { canvasOriginItem } from '../../../shared/platform/storage';
import { canvasError } from './testing/fakeCanvas';
import {
  ORIGIN,
  createHarness,
  loadReady,
  settleAll,
  useScenarioClock,
  type Harness,
} from './testing/harness';

beforeEach(() => useScenarioClock());
afterEach(async () => {
  vi.restoreAllMocks();
  await settleAll();
  vi.useRealTimers();
});
const OTHER = 'https://other.instructure.com';
const BIO = IDS.courses.biology;
const input = {
  title: 'Abandon trigger',
  date: '2026-10-29',
  time: null,
  courseId: null,
  details: '',
};
async function abandon(h: Harness) {
  h.canvas.fail('getSelf', canvasError('server', 500), { times: 1 });
  expect(await h.owner.act({ kind: 'createTask', input }, undefined, ORIGIN)).toMatchObject({
    created: false,
  });
}

it('queues a dashboard mark with a fresh stamp after the surface wait abandons its queue', async () => {
  const h = await createHarness();
  await loadReady(h);
  h.canvas.setAnnouncements(BIO, [{ id: '11', title: 'Notice', message: 'Body', posted_at: null }]);
  vi.mocked(h.deps.surfaceUsesRequestStore).mockImplementationOnce(async () => {
    await abandon(h);
    return true;
  });
  await expect(
    h.owner.markDashboardAnnouncement(BIO, '11', true, IDS.user, 1, ORIGIN),
  ).resolves.toEqual({ ok: true });
  expect(h.canvas.callsOf('setAnnouncementRead')).toEqual([[BIO, '11', true]]);
});

it('refuses another origin before checking the announcement tab cookie store', async () => {
  const h = await createHarness();
  await loadReady(h);
  vi.mocked(h.deps.surfaceUsesRequestStore).mockResolvedValue(false);
  await expect(h.owner.announcement(BIO, '11', OTHER, 1)).rejects.toThrow(
    'The announcements are not available',
  );
  expect(h.deps.surfaceUsesRequestStore).not.toHaveBeenCalled();
});

it('reconciles the saved address when the feed arrives before its watcher', async () => {
  const h = await createHarness();
  await loadReady(h);
  await canvasOriginItem.setValue(OTHER);
  await h.owner.announcementFeed(
    { surface: 'panel', scopeCourseId: null, tab: null, force: false },
    undefined,
    OTHER,
  );
  await h.owner.settled();
  expect(h.createApi.mock.calls.map(([origin]) => origin)).toContain(OTHER);
  await expect(h.owner.dashboardData(OTHER)).resolves.toMatchObject({
    origin: OTHER,
    userId: IDS.user,
  });
});

it('starts the viewer read with a fresh stamp after a same-student surface abandon', async () => {
  const h = await createHarness();
  await loadReady(h);
  vi.mocked(h.deps.surfaceUsesRequestStore).mockImplementationOnce(async () => {
    await abandon(h);
    return true;
  });
  const read = vi.fn(async () => 'file');
  await expect(h.owner.viewerRead(ORIGIN, 1, read)).resolves.toBe('file');
  expect(read).toHaveBeenCalledTimes(1);
});

it('refuses an assignment response before reading settings from another identity', async () => {
  const h = await createHarness();
  await loadReady(h);
  h.canvas.setAssignmentView('12', '101', rawRecords());
  vi.spyOn(h.canvas, 'withPriority').mockReturnValue(h.canvas);
  const original = h.canvas.getOwnSubmissionRecord.bind(h.canvas);
  let checkSettings: () => void = () => {
    throw new Error('The submission read did not finish');
  };
  vi.spyOn(h.canvas, 'getOwnSubmissionRecord').mockImplementationOnce(async (...args) => {
    const record = await original(...args);
    await canvasOriginItem.setValue(OTHER);
    await h.owner.originChanged(OTHER);
    await loadReady(h);
    const reads = vi.spyOn(h.deps.store.settings, 'getValue');
    checkSettings = () => {
      expect(reads).not.toHaveBeenCalled();
    };
    return record;
  });
  await expect(h.owner.assignmentDetails('12', '101', ORIGIN, 1)).rejects.toThrow();
  checkSettings();
});

it('reports a saved dashboard mark after a same-student abandon during its response', async () => {
  const h = await createHarness();
  await loadReady(h);
  h.canvas.setAnnouncements(BIO, [{ id: '11', title: 'Notice', message: 'Body', posted_at: null }]);
  vi.spyOn(h.canvas, 'withGuard').mockReturnValue(h.canvas);
  const original = h.canvas.setAnnouncementRead.bind(h.canvas);
  vi.spyOn(h.canvas, 'setAnnouncementRead').mockImplementationOnce(async (...args) => {
    await original(...args);
    await abandon(h);
  });
  await expect(
    h.owner.markDashboardAnnouncement(BIO, '11', true, IDS.user, 1, ORIGIN),
  ).resolves.toEqual({ ok: true });
  expect(h.canvas.callsOf('setAnnouncementRead')).toEqual([[BIO, '11', true]]);
});

it('does not repeat a rubric mark that finishes on its retry before a same-student abandon', async () => {
  const h = await createHarness();
  await loadReady(h);
  vi.mocked(h.deps.surfaceUsesRequestStore).mockResolvedValueOnce(false);
  vi.spyOn(h.canvas, 'withGuard').mockReturnValue(h.canvas);
  const original = h.canvas.markRubricCommentsRead.bind(h.canvas);
  vi.spyOn(h.canvas, 'markRubricCommentsRead').mockImplementationOnce(async (...args) => {
    await original(...args);
    await abandon(h);
  });
  await expect(
    h.owner.markRubricRead(BIO, IDS.assignments.bioQuiz3Today, IDS.user, ORIGIN, 1),
  ).resolves.toBeUndefined();
  expect(h.canvas.callsOf('markRubricCommentsRead')).toEqual([
    [BIO, IDS.assignments.bioQuiz3Today, IDS.user],
  ]);
});
