// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pull } from './pull';

/** Gives a list a height of rows that is `scrollHeight`, in an area of `clientHeight`. */
function size(el: HTMLElement, clientHeight: number, scrollHeight: number): void {
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
}

function wheel(target: Element, deltaY: number, init: WheelEventInit = {}): WheelEvent {
  const event = new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true, ...init });
  // The test environment drops some fields of the init, so they are set on the event itself.
  for (const [key, value] of Object.entries(init)) {
    Object.defineProperty(event, key, { value, configurable: true });
  }
  target.dispatchEvent(event);
  return event;
}

describe('pull', () => {
  let root: HTMLElement;
  let first: HTMLElement;
  let second: HTMLElement;
  let stop: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <div id="root">
        <div class="list" id="first" style="overflow-y: auto"><p>One</p></div>
        <div class="list" id="second" style="overflow-y: auto"><p>Two</p></div>
      </div>`;
    root = document.getElementById('root')!;
    first = document.getElementById('first')!;
    second = document.getElementById('second')!;
    // Both lists are short, and the page cannot move: only the rows pull.
    size(first, 100, 100);
    size(second, 100, 100);
    stop = pull(root, '.list');
  });

  afterEach(() => {
    stop();
    vi.useRealTimers();
  });

  it('pulls a list that has nothing to scroll and puts it back, with the scroll bar guard', () => {
    wheel(first.firstElementChild!, 100);
    expect(first.classList.contains('wr-pulling')).toBe(true);
    expect(first.style.getPropertyValue('--wr-pull')).toBe('-18px');
    expect(first.style.overflowY).toBe('hidden');
    vi.advanceTimersByTime(110);
    expect(first.classList.contains('wr-pulling')).toBe(false);
    // The rows spring back before the list may show a scroll bar again.
    expect(first.style.overflowY).toBe('hidden');
    vi.advanceTimersByTime(250);
    expect(first.getAttribute('style')).toBe('overflow-y: auto;');
  });

  it('keeps the state of each list apart, so a pull on one never cancels the other', () => {
    wheel(first.firstElementChild!, 100);
    vi.advanceTimersByTime(30);
    wheel(second.firstElementChild!, 100);
    vi.advanceTimersByTime(400);
    for (const list of [first, second]) {
      expect(list.classList.contains('wr-pulling')).toBe(false);
      expect(list.style.getPropertyValue('--wr-pull')).toBe('');
      expect(list.style.overflowY).toBe('auto');
    }
  });

  it('puts every list back at once when it is stopped, and then keeps no timer', () => {
    wheel(first.firstElementChild!, 100);
    wheel(second.firstElementChild!, -100);
    stop();
    for (const list of [first, second]) {
      expect(list.classList.contains('wr-pulling')).toBe(false);
      expect(list.style.getPropertyValue('--wr-pull')).toBe('');
      expect(list.style.overflowY).toBe('auto');
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it('lets a list that can still scroll take the wheel, and ignores Ctrl and sideways wheels', () => {
    size(first, 100, 400);
    expect(wheel(first.firstElementChild!, 100).defaultPrevented).toBe(false);
    expect(first.classList.contains('wr-pulling')).toBe(false);
    wheel(second.firstElementChild!, 100, { ctrlKey: true });
    expect(second.classList.contains('wr-pulling')).toBe(false);
    wheel(second.firstElementChild!, 10, { deltaX: 100 });
    expect(second.classList.contains('wr-pulling')).toBe(false);
  });

  it('keeps the page still at the end of a list with rows to scroll', () => {
    size(first, 100, 400);
    first.scrollTop = 300;
    expect(wheel(first.firstElementChild!, 100).defaultPrevented).toBe(true);
    expect(first.classList.contains('wr-pulling')).toBe(true);
    // A list with rows to scroll grows no guard: its scroll bar stays.
    expect(first.style.overflowY).toBe('auto');
  });

  it('stops the wheel at the end of a short list in a frame, where no page can take it', () => {
    stop();
    stop = pull(root, '.list', true);
    expect(wheel(first.firstElementChild!, 100).defaultPrevented).toBe(true);
    expect(first.classList.contains('wr-pulling')).toBe(true);
  });
});
