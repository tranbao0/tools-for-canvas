import { expect, afterEach, beforeEach, it, vi } from 'vitest';
import { createHarness, loadReady, ORIGIN, settleAll, useScenarioClock } from './testing/harness';
beforeEach(() => useScenarioClock());
afterEach(async () => {
  await settleAll();
  vi.useRealTimers();
});
it.each([2, 3])('drops a viewer reply during its final handoff (%i)', async (depth) => {
  const h = await createHarness();
  await loadReady(h);
  let read = false;
  let armed = true;
  vi.mocked(h.deps.sessionFingerprint).mockImplementation(async () => {
    if (read && armed) {
      armed = false;
      const change = (left: number) => {
        if (left === 0) void h.owner.originChanged(null);
        else queueMicrotask(() => change(left - 1));
      };
      change(depth);
    }
    return 'session-a';
  });
  const result = await h.owner
    .viewerRead(ORIGIN, 1, async () => {
      read = true;
      return 'file';
    })
    .catch(() => null);
  expect(result).toBeNull();
  await h.owner.settled();
});

it.each([1, 2, 3, 4])('drops visibility during its final handoff (%i)', async (depth) => {
  const h = await createHarness();
  await loadReady(h);
  vi.spyOn(h.canvas, 'withPriority').mockReturnValue(h.canvas);
  h.canvas.getWidgetGradeVisibility = async () => {
    const change = (left: number) => {
      if (left === 0) void h.owner.originChanged(null);
      else queueMicrotask(() => change(left - 1));
    };
    change(depth);
    return { gradeVisibilities: {}, showGrades: {} };
  };
  const result = await h.owner.dashboardGradeVisibility(undefined, 1, ORIGIN);
  expect(result.gradeVisibilities).toBeNull();
  await h.owner.settled();
});

it('does not publish late visibility after the Canvas changes during its handoff', async () => {
  const h = await createHarness();
  await loadReady(h);
  let finish!: () => void;
  vi.spyOn(h.canvas, 'withPriority').mockReturnValue(h.canvas);
  h.canvas.getWidgetGradeVisibility = () =>
    new Promise((resolve) => {
      finish = () => {
        queueMicrotask(() => {
          void h.owner.originChanged(null);
        });
        resolve({ gradeVisibilities: {}, showGrades: {} });
      };
    });
  const pending = h.owner.dashboardGradeVisibility(undefined, 1, ORIGIN);
  await vi.advanceTimersByTimeAsync(5000);
  expect((await pending).gradeVisibilities).toBeNull();
  const marker = vi.spyOn(h.deps.store.changeMarker, 'setValue');
  finish();
  await vi.advanceTimersByTimeAsync(0);
  await h.owner.settled();
  expect(marker).toHaveBeenCalledTimes(1);
});

it.each(['announcement', 'announcementPage', 'announcementRange', 'peoplePage'] as const)(
  'drops %s during the final response handoff',
  async (surface) => {
    const h = await createHarness();
    await loadReady(h);
    let read = false;
    let armed = true;
    h.canvas.getAnnouncement = async () => {
      read = true;
      return { id: '11', title: 'Private', message: 'Private body', posted_at: null };
    };
    h.canvas.listAnnouncementPage = async () => {
      read = true;
      return { nodes: [], count: 0, total: 0, hasNext: false };
    };
    h.canvas.listAnnouncementFeed = async () => {
      read = true;
      return [];
    };
    h.canvas.listPeoplePage = async () => {
      read = true;
      return { nodes: [], count: 0, total: 0, hasNext: false };
    };
    vi.mocked(h.deps.sessionFingerprint).mockImplementation(async () => {
      if (read && armed) {
        armed = false;
        queueMicrotask(() =>
          queueMicrotask(() => {
            void h.owner.originChanged(null);
          }),
        );
      }
      return 'session-a';
    });
    const reply = (
      surface === 'announcement'
        ? h.owner.announcement('101', '11', ORIGIN, 1)
        : surface === 'announcementPage'
          ? h.owner.announcementPage(
              { courseId: null, read: 'all', offset: 0, first: 10 },
              ORIGIN,
              1,
            )
          : surface === 'announcementRange'
            ? h.owner.announcementRange(
                { courseId: null, from: '2026-10-20', to: '2026-10-29' },
                ORIGIN,
                1,
              )
            : h.owner.peoplePage({ courseId: null, role: 'all', offset: 0, first: 10 }, ORIGIN, 1)
    ).catch(() => null);
    expect(await reply).toBeNull();
  },
);

it.each(['viewerUserId', 'viewerMayFetch', 'viewerConfirm'] as const)(
  'drops %s when the Canvas changes after the viewer context returns',
  async (surface) => {
    const h = await createHarness();
    await loadReady(h);
    let armed = true;
    vi.spyOn(h.deps.clock, 'now').mockImplementation(() => {
      if (armed) {
        armed = false;
        queueMicrotask(() => {
          void h.owner.originChanged(null);
        });
      }
      return Date.now();
    });
    const result = await h.owner[surface](ORIGIN, 1);
    expect(result).toBe(surface === 'viewerUserId' ? null : false);
  },
);
