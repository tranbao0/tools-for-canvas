/**
 * The small parts that every surface host shares. They use no extension storage, so the in-page
 * script, which must never touch it, can import them. See docs/design.md, decision 5.
 */
import { browser } from 'wxt/browser';
import type { DataMessage } from '../data/protocol';
import type { Leave, SurfaceTimers, Visibility } from './runtime';

export function sendToBackground(message: DataMessage): Promise<unknown> {
  return browser.runtime.sendMessage(message);
}

export const browserTimers: SurfaceTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export const systemClock = { now: (): number => Date.now() };

/** Document visibility: a hidden panel or a background tab stops its timers. */
export function documentVisibility(doc: Document = document): Visibility {
  const isVisible = (): boolean => doc.visibilityState === 'visible';
  return {
    isVisible,
    watch(listener) {
      const onChange = (): void => listener(isVisible());
      doc.addEventListener('visibilitychange', onChange);
      return () => doc.removeEventListener('visibilitychange', onChange);
    },
  };
}

/** The page goes away: `pagehide` fires when a panel closes or a tab leaves the page. */
export function pageLeave(win: Window = window): Leave {
  return {
    watch(listener) {
      const onHide = (): void => listener();
      win.addEventListener('pagehide', onHide);
      return () => win.removeEventListener('pagehide', onHide);
    },
  };
}
