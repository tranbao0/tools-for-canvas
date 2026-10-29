import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canvasOriginItem, offerItem } from '../../platform/storage';
import {
  ORIGIN,
  PANEL,
  createHarness,
  joinRanges,
  loadReady,
  rangeOf,
  useScenarioClock,
} from '../testing/harness';

const CUSTOM = 'https://canvas.school.edu';
const OTHER = 'https://other.instructure.com';
const BETA = 'https://school.beta.instructure.com';

beforeEach(() => useScenarioClock());
afterEach(() => vi.useRealTimers());

describe('a Canvas page found by the detector', () => {
  it.each([
    ['an instructure.com address', ORIGIN],
    ['a custom domain', CUSTOM],
    ['a custom domain with a port', 'https://canvas.school.edu:8443'],
  ])('saves %s when none is saved, and loads the list', async (_name, page) => {
    const h = await createHarness({ origin: null });

    expect(await h.owner.canvasDetected(page)).toBe(page);
    await h.owner.settled();

    expect(await canvasOriginItem.getValue()).toBe(page);
    expect(await offerItem.getValue()).toBeNull();
    expect(h.createApi).toHaveBeenCalledWith(page);
    expect((await h.owner.getState(PANEL)).kind).toBe('ready');
  });

  it.each([
    ['a test host', 'https://school.test.instructure.com'],
    ['a beta host', BETA],
  ])('saves nothing for %s when none is saved, and offers it', async (_name, page) => {
    const h = await createHarness({ origin: null });

    expect(await h.owner.canvasDetected(page)).toBeNull();

    expect(await canvasOriginItem.getValue()).toBeNull();
    expect(await offerItem.getValue()).toEqual({ origin: page, mode: 'use' });
    expect(await h.owner.getState(PANEL)).toEqual({
      kind: 'not_set_up',
      offer: { origin: page, mode: 'use' },
    });
  });

  it.each([
    ['another instructure.com Canvas', OTHER],
    ['a custom domain', CUSTOM],
    ['a beta host', BETA],
  ])(
    'keeps the saved address for %s, and offers a switch in the panel only',
    async (_name, page) => {
      const h = await createHarness();

      expect(await h.owner.canvasDetected(page)).toBe(ORIGIN);

      expect(await canvasOriginItem.getValue()).toBe(ORIGIN);
      expect(await offerItem.getValue()).toEqual({ origin: page, mode: 'switch' });
      await loadReady(h);
      const panel = await h.owner.getState(PANEL);
      expect(panel).toMatchObject({ kind: 'ready', offer: { origin: page, mode: 'switch' } });
      const inpage = await h.owner.getState({ ...PANEL, surface: 'inpage' });
      expect(inpage).toMatchObject({ kind: 'ready', offer: null });
    },
  );

  it('stores no offer for the saved address', async () => {
    const h = await createHarness();

    expect(await h.owner.canvasDetected(ORIGIN)).toBe(ORIGIN);

    expect(await offerItem.getValue()).toBeNull();
  });

  it.each([
    ['an http origin', 'http://school.instructure.com'],
    ['an IP address', 'https://192.168.1.20'],
    ['a host with no dot', 'https://canvas'],
    ['an extension page', 'chrome-extension://abcdef'],
    ['a page with a path', 'https://canvas.school.edu/courses/1'],
  ])('saves and offers nothing for %s', async (_name, page) => {
    const h = await createHarness({ origin: null });

    expect(await h.owner.canvasDetected(page)).toBeNull();

    expect(await canvasOriginItem.getValue()).toBeNull();
    expect(await offerItem.getValue()).toBeNull();
  });
});

describe('accepting the offer', () => {
  it('saves the offered address, clears the offer and loads the list', async () => {
    const h = await createHarness({ origin: null });
    await offerItem.setValue({ origin: CUSTOM, mode: 'use' });

    expect(await h.owner.acceptOffer(CUSTOM)).toBe(true);
    await h.owner.settled();

    expect(await offerItem.getValue()).toBeNull();
    expect(await canvasOriginItem.getValue()).toBe(CUSTOM);
    expect((await h.owner.getState(PANEL)).kind).toBe('ready');
  });

  it('switches to another Canvas and drops the old data', async () => {
    const h = await createHarness();
    await loadReady(h);
    await offerItem.setValue({ origin: CUSTOM, mode: 'switch' });

    expect(await h.owner.acceptOffer(CUSTOM)).toBe(true);
    await h.owner.settled();

    expect(await canvasOriginItem.getValue()).toBe(CUSTOM);
    expect(h.createApi).toHaveBeenLastCalledWith(CUSTOM);
  });

  it('runs one full round, with the origin watcher of the background', async () => {
    const h = await createHarness({ origin: null });
    await offerItem.setValue({ origin: ORIGIN, mode: 'use' });
    const watched: Promise<void>[] = [];
    const stop = canvasOriginItem.watch((origin) => {
      watched.push(h.owner.originChanged(origin));
    });

    await h.owner.acceptOffer(ORIGIN);
    await h.owner.settled();
    await Promise.all(watched);
    await h.owner.settled();
    stop();

    expect(watched.length).toBeGreaterThan(0);
    expect(h.canvas.callsOf('getProfile')).toHaveLength(1);
    // One round: the chunks of the current week's planner range, each asked for once.
    expect(joinRanges(h.canvas.plannerRanges())).toEqual([await rangeOf(h, 0)]);
    expect(h.canvas.callsOf('listUndatedAssignments')).toHaveLength(5);
  });

  it.each([
    ['an origin that is not the offered one', OTHER],
    ['a page with a path', `${CUSTOM}/courses/1`],
  ])('refuses %s', async (_name, origin) => {
    const h = await createHarness();
    await offerItem.setValue({ origin: CUSTOM, mode: 'switch' });

    expect(await h.owner.acceptOffer(origin)).toBe(false);

    expect(await canvasOriginItem.getValue()).toBe(ORIGIN);
    expect(await offerItem.getValue()).toEqual({ origin: CUSTOM, mode: 'switch' });
  });

  it('refuses when no offer is stored', async () => {
    const h = await createHarness();

    expect(await h.owner.acceptOffer(CUSTOM)).toBe(false);

    expect(await canvasOriginItem.getValue()).toBe(ORIGIN);
  });
});

describe('the saved address', () => {
  it('refreshes after access to the saved address is granted again', async () => {
    const h = await createHarness();
    h.hasAccess.mockResolvedValue(false);
    expect(await h.owner.getState(PANEL)).toEqual({
      kind: 'no_access',
      origin: ORIGIN,
      offer: null,
    });

    h.hasAccess.mockResolvedValue(true);
    await h.owner.accessChanged();
    await h.owner.settled();

    expect((await h.owner.getState(PANEL)).kind).toBe('ready');
  });

  it('follows an address that the background saved for another page', async () => {
    const h = await createHarness({ origin: null });
    expect((await h.owner.getState(PANEL)).kind).toBe('not_set_up');

    await canvasOriginItem.setValue(ORIGIN);
    expect(await h.owner.getState(PANEL)).toEqual({ kind: 'loading' });
    await h.owner.settled();

    expect((await h.owner.getState(PANEL)).kind).toBe('ready');
  });
});
