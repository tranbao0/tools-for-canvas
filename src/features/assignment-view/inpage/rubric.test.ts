// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findRubric,
  restoreStaleRubric,
  rubricAtRest,
  RUBRIC_WRAPPER_ID,
  takeRubric,
  unreadRubricMark,
  whenRubricOnScreen,
  whenRubricReady,
} from './rubric';

// The layout of app/views/layouts/application.html.erb around the page: Canvas's script marks the
// siblings of every ancestor of the holder, and the watermark has aria-hidden="true" all the time.
const PAGE = `<div id="application"><div id="main"><div class="ic-Layout-watermark" aria-hidden="true"></div><div id="not_right_side"><div id="content">
  <div class="submission-details-header"><div class="submission-details-header__rubric"><a href="#" class="assess_submission_link">Show Rubric</a></div></div>
  <div id="rubric_holder" style="display: none;"><div class="rubric">criteria</div></div>
  <div class="submission-details-container"></div>
</div></div></div></div><div id="aria_alerts"></div>`;

beforeEach(() => {
  document.body.innerHTML = PAGE;
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('findRubric', () => {
  it('finds the holder when Canvas draws "Show Rubric" and the holder has a rubric', () => {
    expect(findRubric(document)).toBe(document.getElementById('rubric_holder'));
  });

  it('finds nothing without the link, without a rubric inside, or without a holder', () => {
    document.querySelector('.assess_submission_link')!.remove();
    expect(findRubric(document)).toBeNull();
    document.body.innerHTML = PAGE.replace('class="rubric"', 'class="other"');
    expect(findRubric(document)).toBeNull();
    document.body.innerHTML = '<div class="submission-details-header"></div>';
    expect(findRubric(document)).toBeNull();
  });
});

describe('takeRubric', () => {
  it('moves the same node into the wrapper and puts it back exactly', () => {
    const before = document.getElementById('content')!.outerHTML;
    const holder = findRubric(document)!;
    const wrapper = document.createElement('div');
    document.body.append(wrapper);
    const restore = takeRubric(document, holder, wrapper);
    expect(holder.parentElement).toBe(wrapper);
    expect(wrapper.id).toBe(RUBRIC_WRAPPER_ID);
    // Neither the attributes nor the style of Canvas's node changed.
    expect(holder.outerHTML).toBe(
      '<div id="rubric_holder" style="display: none;"><div class="rubric">criteria</div></div>',
    );
    restore();
    expect(wrapper.isConnected).toBe(false);
    expect(document.getElementById('content')!.outerHTML).toBe(before);
    expect(document.getElementById('rubric_holder')).toBe(holder);
  });

  it('stops Tab and Escape at the wrapper and lets other keys through', () => {
    const holder = findRubric(document)!;
    const wrapper = document.createElement('div');
    document.body.append(wrapper);
    takeRubric(document, holder, wrapper);
    const seen: string[] = [];
    holder.addEventListener('keydown', (event) => seen.push(event.key));
    for (const key of ['Tab', 'Escape', 'ArrowDown', 'Enter']) {
      holder.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    }
    expect(seen).toEqual(['ArrowDown', 'Enter']);
  });

  it('keeps the holder when the place it came from is gone', () => {
    const holder = findRubric(document)!;
    const wrapper = document.createElement('div');
    document.body.append(wrapper);
    const restore = takeRubric(document, holder, wrapper);
    document.getElementById('content')!.remove();
    restore();
    expect(document.getElementById('rubric_holder')).toBe(holder);
  });
});

describe('restoreStaleRubric', () => {
  it('puts the holder back from the wrapper of an earlier copy, before the wrapper is removed', () => {
    const before = document.getElementById('content')!.outerHTML;
    const holder = findRubric(document)!;
    const wrapper = document.createElement('div');
    document.body.append(wrapper);
    takeRubric(document, holder, wrapper);
    restoreStaleRubric(document);
    wrapper.remove();
    expect(document.getElementById('content')!.outerHTML).toBe(before);
  });

  it('removes a mark that has no holder in a wrapper, and does nothing on a clean page', () => {
    restoreStaleRubric(document);
    document.getElementById('content')!.prepend(document.createComment('av-rubric-home'));
    restoreStaleRubric(document);
    expect(document.getElementById('content')!.innerHTML).not.toContain('av-rubric-home');
  });
});

/** What `makeRubricAccessible` marks: the siblings of the holder, and of every ancestor up to `#application`. */
const SETUP = () => {
  const siblings = (node: Element) => [...node.parentElement!.children].filter((n) => n !== node);
  const holder = document.getElementById('rubric_holder')!;
  siblings(holder).forEach((n) => n.setAttribute('data-hide_from_rubric', 'true'));
  for (let up = holder.parentElement; up && up.id !== 'application'; up = up.parentElement) {
    siblings(up)
      .filter((n) => n.id !== 'aria_alerts')
      .forEach((n) => n.setAttribute('data-hide_from_rubric', 'true'));
  }
};
/** What `toggleRubric` sets on every marked node of the page. */
const TOGGLE = (value: 'true' | 'false') =>
  document
    .querySelectorAll('[data-hide_from_rubric]')
    .forEach((n) => n.setAttribute('aria-hidden', value));
const container = () => document.querySelector('.submission-details-container')!;

describe('whenRubricReady', () => {
  const holder = () => document.getElementById('rubric_holder')!;

  it('calls at once when Canvas has set the rubric up and the holder is at rest', () => {
    SETUP();
    const ready = vi.fn();
    whenRubricReady(document, holder(), ready);
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it('is at rest on a real page load, where the watermark of the layout is aria-hidden all the time', () => {
    SETUP();
    expect(document.querySelector('.ic-Layout-watermark')!.getAttribute('aria-hidden')).toBe(
      'true',
    );
    expect(
      document.querySelector('.ic-Layout-watermark')!.hasAttribute('data-hide_from_rubric'),
    ).toBe(true);
    const ready = vi.fn();
    whenRubricReady(document, holder(), ready);
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it('waits for the setup, and calls once', async () => {
    const ready = vi.fn();
    whenRubricReady(document, holder(), ready);
    expect(ready).not.toHaveBeenCalled();
    SETUP();
    await vi.waitFor(() => expect(ready).toHaveBeenCalledTimes(1));
  });

  it('never calls when the setup does not come, or after it was stopped', async () => {
    vi.useFakeTimers();
    const ready = vi.fn();
    whenRubricReady(document, holder(), ready);
    vi.advanceTimersByTime(6000);
    const stopped = vi.fn();
    whenRubricReady(document, holder(), stopped)();
    SETUP();
    await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();
    expect(stopped).not.toHaveBeenCalled();
  });

  it('waits while the pop-up of Canvas is open, and takes the holder after Canvas closes it', async () => {
    SETUP();
    holder().style.display = 'block';
    TOGGLE('true');
    const ready = vi.fn();
    whenRubricReady(document, holder(), ready);
    await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();
    // The holder is hidden again, but the nodes are still hidden from screen readers.
    holder().style.display = 'none';
    await Promise.resolve();
    await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();
    TOGGLE('false');
    await vi.waitFor(() => expect(ready).toHaveBeenCalledTimes(1));
  });

  it('keeps waiting for the close of a pop-up longer than the wait for the setup', async () => {
    vi.useFakeTimers();
    SETUP();
    holder().style.display = 'block';
    const ready = vi.fn();
    whenRubricReady(document, holder(), ready);
    vi.advanceTimersByTime(60_000);
    holder().style.display = 'none';
    await vi.advanceTimersByTimeAsync(10);
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it('does not watch the whole document: a style change far from the holder wakes nothing', async () => {
    SETUP();
    holder().style.display = 'block';
    const ready = vi.fn();
    whenRubricReady(document, holder(), ready);
    const observe = vi.spyOn(MutationObserver.prototype, 'observe');
    whenRubricReady(document, holder(), vi.fn());
    const targets = observe.mock.calls.map(([target]) => target);
    expect(targets).not.toContain(document.documentElement);
    expect(targets).not.toContain(document.body);
    expect(targets).toContain(holder());
    observe.mockRestore();
  });
});

describe('rubricAtRest', () => {
  it('needs the inline display none, the home place and no hidden sibling of the holder', () => {
    SETUP();
    const holder = document.getElementById('rubric_holder')!;
    expect(rubricAtRest(document, holder)).toBe(true);
    holder.style.display = 'block';
    expect(rubricAtRest(document, holder)).toBe(false);
    holder.style.display = 'none';
    container().setAttribute('aria-hidden', 'true');
    expect(rubricAtRest(document, holder)).toBe(false);
    container().setAttribute('aria-hidden', 'false');
    expect(rubricAtRest(document, holder)).toBe(true);
    const wrapper = document.createElement('div');
    wrapper.id = 'av-rubric';
    wrapper.append(holder);
    expect(rubricAtRest(document, holder)).toBe(false);
  });

  it('does not count a node that is hidden from screen readers far from the holder', () => {
    SETUP();
    const holder = document.getElementById('rubric_holder')!;
    document.getElementById('aria_alerts')!.setAttribute('aria-hidden', 'true');
    document.querySelector('.ic-Layout-watermark')!.setAttribute('aria-hidden', 'true');
    expect(rubricAtRest(document, holder)).toBe(true);
  });
});

describe('unreadRubricMark', () => {
  it('finds the mark Canvas draws, and none after Canvas or the view hid it', () => {
    const rubric = document.querySelector('.submission-details-header__rubric')!;
    expect(unreadRubricMark(document)).toBeNull();
    const mark = document.createElement('span');
    mark.className = 'rubric_comment unread_indicator';
    rubric.append(mark);
    expect(unreadRubricMark(document)).toBe(mark);
    mark.style.display = 'none';
    expect(unreadRubricMark(document)).toBeNull();
  });
});

describe('whenRubricOnScreen', () => {
  let observed: ((entries: { isIntersecting: boolean }[]) => void) | null = null;
  let visibility = 'visible';

  beforeEach(() => {
    observed = null;
    visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });
    class FakeObserver {
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        observed = callback;
      }
      observe = vi.fn();
      disconnect = vi.fn();
    }
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    Object.defineProperty(window, 'IntersectionObserver', {
      configurable: true,
      value: FakeObserver,
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, 'visibilityState');
  });

  const holder = () => document.getElementById('rubric_holder')!;

  it('calls once, when the holder comes into view', () => {
    const onScreen = vi.fn();
    whenRubricOnScreen(document, holder(), onScreen);
    observed!([{ isIntersecting: false }]);
    expect(onScreen).not.toHaveBeenCalled();
    observed!([{ isIntersecting: true }]);
    observed!([{ isIntersecting: true }]);
    expect(onScreen).toHaveBeenCalledTimes(1);
  });

  it('waits in a background tab until the page is visible', () => {
    visibility = 'hidden';
    const onScreen = vi.fn();
    whenRubricOnScreen(document, holder(), onScreen);
    observed!([{ isIntersecting: true }]);
    expect(onScreen).not.toHaveBeenCalled();
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(onScreen).toHaveBeenCalledTimes(1);
  });

  it('never calls after it was stopped, or without an observer', () => {
    const onScreen = vi.fn();
    whenRubricOnScreen(document, holder(), onScreen)();
    observed!([{ isIntersecting: true }]);
    expect(onScreen).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(window, 'IntersectionObserver');
    const other = vi.fn();
    whenRubricOnScreen(document, holder(), other);
    expect(other).not.toHaveBeenCalled();
  });
});
