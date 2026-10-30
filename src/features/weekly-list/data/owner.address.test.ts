import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canvasOriginItem, offerItem } from '../../../shared/platform/storage';
import {
  ORIGIN,
  PANEL,
  createHarness,
  joinRanges,
  loadReady,
  rangeOf,
  useScenarioClock,
} from './testing/harness';

const CUSTOM = 'https://canvas.school.edu';
const OTHER = 'https://other.instructure.com';
const BETA = 'https://school.beta.instructure.com';

beforeEach(() => useScenarioClock());
afterEach(() => vi.useRealTimers());

describe('a Canvas page found by the detector', () => {
  it.each([
    ['an instructure.com address', ORIGIN],
    ['an instructure.com address with a port', 'https://school.instructure.com:8443'],
  ])('saves %s when none is saved, and loads the list', async (_name, page) => {
    const h = await createHarness({ origin: null });

    expect(await h.owner.canvasDetected(page)).toBe('saved');
    await h.owner.settled();

    expect(await canvasOriginItem.getValue()).toBe(page);
    expect(await offerItem.getValue()).toBeNull();
    expect(h.createApi).toHaveBeenCalledWith(page);
    expect((await h.owner.getState(PANEL)).kind).toBe('ready');
  });

  it.each([
    ['a custom domain', CUSTOM],
    ['a custom domain with a port', 'https://canvas.school.edu:8443'],
    ['a look-alike of instructure.com', 'https://instructure.com.evil.example'],
    ['a test host', 'https://school.test.instructure.com'],
    ['a beta host', BETA],
  ])('saves nothing for %s when none is saved, and stores it as the offer', async (_name, page) => {
    const h = await createHarness({ origin: null });

    expect(await h.owner.canvasDetected(page)).toBe('confirm');

    expect(await canvasOriginItem.getValue()).toBeNull();
    expect(await offerItem.getValue()).toEqual({ origin: page });
    expect(h.createApi).not.toHaveBeenCalled();
    // The welcome page and the panel show the offer, and the in-page list never does.
    for (const surface of ['panel', 'page'] as const) {
      expect(await h.owner.getState({ ...PANEL, surface })).toEqual({
        kind: 'not_set_up',
        offer: { origin: page },
      });
    }
    expect(await h.owner.getState({ ...PANEL, surface: 'inpage' })).toEqual({
      kind: 'not_set_up',
      offer: null,
    });
  });

  it('keeps the newest page as the offer when several unsaved Canvases report', async () => {
    const h = await createHarness({ origin: null });

    expect(await h.owner.canvasDetected(CUSTOM)).toBe('confirm');
    expect(await h.owner.canvasDetected('https://canvas.state.edu')).toBe('confirm');

    expect(await offerItem.getValue()).toEqual({ origin: 'https://canvas.state.edu' });
    expect(await canvasOriginItem.getValue()).toBeNull();
  });

  it.each([
    ['another instructure.com Canvas', OTHER],
    ['a custom domain', CUSTOM],
    ['a beta host', BETA],
  ])(
    'keeps the saved address for %s, and offers a switch in the panel only',
    async (_name, page) => {
      const h = await createHarness();

      expect(await h.owner.canvasDetected(page)).toBe('other');

      expect(await canvasOriginItem.getValue()).toBe(ORIGIN);
      expect(await offerItem.getValue()).toEqual({ origin: page });
      await loadReady(h);
      const panel = await h.owner.getState(PANEL);
      expect(panel).toMatchObject({ kind: 'ready', offer: { origin: page } });
      const inpage = await h.owner.getState({ ...PANEL, surface: 'inpage' });
      expect(inpage).toMatchObject({ kind: 'ready', offer: null });
    },
  );

  it('stores no offer for the saved address, which shows the list', async () => {
    const h = await createHarness();

    expect(await h.owner.canvasDetected(ORIGIN)).toBe('saved');

    expect(await offerItem.getValue()).toBeNull();
  });

  it.each([
    ['an http origin', 'http://school.instructure.com'],
    ['an IP address', 'https://192.168.1.20'],
    ['a host with no dot', 'https://canvas'],
    ['an extension page', 'chrome-extension://abcdef'],
    ['a page with a path', 'https://canvas.school.edu/courses/1'],
  ])('shows nothing for %s, and saves and offers nothing', async (_name, page) => {
    for (const saved of [null, ORIGIN]) {
      const h = await createHarness({ origin: saved });

      expect(await h.owner.canvasDetected(page)).toBe('other');

      expect(await canvasOriginItem.getValue()).toBe(saved);
      expect(await offerItem.getValue()).toBeNull();
    }
  });
});

describe('accepting the offer', () => {
  it('saves the offered address, clears the offer and loads the list', async () => {
    const h = await createHarness({ origin: null });
    await offerItem.setValue({ origin: CUSTOM });

    expect(await h.owner.acceptOffer(CUSTOM)).toBe(true);
    await h.owner.settled();

    expect(await offerItem.getValue()).toBeNull();
    expect(await canvasOriginItem.getValue()).toBe(CUSTOM);
    expect((await h.owner.getState(PANEL)).kind).toBe('ready');
  });

  it('switches to another Canvas and drops the old data', async () => {
    const h = await createHarness();
    await loadReady(h);
    await offerItem.setValue({ origin: CUSTOM });

    expect(await h.owner.acceptOffer(CUSTOM)).toBe(true);
    await h.owner.settled();

    expect(await canvasOriginItem.getValue()).toBe(CUSTOM);
    expect(h.createApi).toHaveBeenLastCalledWith(CUSTOM);
  });

  it('runs one full round, with the origin watcher of the background', async () => {
    const h = await createHarness({ origin: null });
    await offerItem.setValue({ origin: ORIGIN });
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
    await offerItem.setValue({ origin: CUSTOM });

    expect(await h.owner.acceptOffer(origin)).toBe(false);

    expect(await canvasOriginItem.getValue()).toBe(ORIGIN);
    expect(await offerItem.getValue()).toEqual({ origin: CUSTOM });
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

describe('reports that arrive together', () => {
  it('save only the first instructure.com Canvas, and tell no later page that it is saved', async () => {
    const h = await createHarness({ origin: null });

    const answers = await Promise.all([
      h.owner.canvasDetected(ORIGIN),
      h.owner.canvasDetected(OTHER),
      h.owner.canvasDetected(CUSTOM),
    ]);
    await h.owner.settled();

    expect(answers).toEqual(['saved', 'other', 'other']);
    expect(await canvasOriginItem.getValue()).toBe(ORIGIN);
    // The last page is the one that the offer names.
    expect(await offerItem.getValue()).toEqual({ origin: CUSTOM });
  });

  it('offers a custom domain until an instructure.com Canvas is saved', async () => {
    const h = await createHarness({ origin: null });

    const answers = await Promise.all([
      h.owner.canvasDetected(CUSTOM),
      h.owner.canvasDetected(ORIGIN),
    ]);

    expect(answers).toEqual(['confirm', 'saved']);
    expect(await canvasOriginItem.getValue()).toBe(ORIGIN);
    // The offer of the custom domain waits in the panel as a switch.
    expect(await loadReady(h)).toMatchObject({ offer: { origin: CUSTOM } });
  });

  it('never let an accepted offer be overwritten by a report that came with it', async () => {
    const h = await createHarness();
    await offerItem.setValue({ origin: CUSTOM });

    const [accepted, detected] = await Promise.all([
      h.owner.acceptOffer(CUSTOM),
      h.owner.canvasDetected(OTHER),
    ]);
    await h.owner.settled();

    expect(accepted).toBe(true);
    expect(detected).toBe('other');
    expect(await canvasOriginItem.getValue()).toBe(CUSTOM);
  });
});

describe('a stored address that is not a usable https origin', () => {
  it.each([
    ['an http origin', 'http://school.instructure.com'],
    ['an address with a path', 'https://school.instructure.com/courses/1'],
    ['an IP address', 'https://10.0.0.1'],
    ['a host with no dot', 'https://canvas'],
    ['an extension page', 'chrome-extension://abcdef'],
    ['text that is no address', 'not an address'],
  ])('is treated as no address for %s, and no Canvas request goes there', async (_name, stored) => {
    const h = await createHarness({ origin: stored });

    for (const surface of ['panel', 'page', 'inpage'] as const) {
      expect(await h.owner.getState({ ...PANEL, surface })).toEqual({
        kind: 'not_set_up',
        offer: null,
      });
    }
    await h.owner.originChanged(stored);
    await h.owner.settled();

    expect(h.createApi).not.toHaveBeenCalled();
    expect(h.canvas.calls).toEqual([]);
  });

  it('lets the first Canvas page that reports itself take the place of the bad text', async () => {
    const h = await createHarness({ origin: 'http://school.instructure.com' });

    expect(await h.owner.canvasDetected(ORIGIN)).toBe('saved');

    expect(await canvasOriginItem.getValue()).toBe(ORIGIN);
  });

  it('is dropped when the address changes to it, and the old data goes', async () => {
    const h = await createHarness();
    await loadReady(h);

    await canvasOriginItem.setValue('https://evil.example/path');
    await h.owner.originChanged('https://evil.example/path');

    expect(await h.owner.getState(PANEL)).toEqual({ kind: 'not_set_up', offer: null });
    expect(h.createApi).not.toHaveBeenCalledWith('https://evil.example/path');
  });
});
