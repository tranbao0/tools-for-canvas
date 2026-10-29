/**
 * Test fakes for the browser APIs that WXT's fake browser does not implement:
 * permissions, scripting, ports, `tabs.sendMessage`, `sidePanel` and `sidebarAction`.
 * Only tests import this module.
 */
import { vi } from 'vitest';
import type { Browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';

type Listener<Args extends unknown[]> = (...args: Args) => unknown;

export interface FakeEvent<Args extends unknown[]> {
  addListener(listener: Listener<Args>): void;
  removeListener(listener: Listener<Args>): void;
  hasListener(listener: Listener<Args>): boolean;
  hasListeners(): boolean;
  /** Calls every listener in order and returns their results. */
  trigger(...args: Args): unknown[];
}

export function fakeEvent<Args extends unknown[]>(): FakeEvent<Args> {
  const listeners: Listener<Args>[] = [];
  return {
    addListener: (listener) => {
      listeners.push(listener);
    },
    removeListener: (listener) => {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    },
    hasListener: (listener) => listeners.includes(listener),
    hasListeners: () => listeners.length > 0,
    trigger: (...args) => [...listeners].map((listener) => listener(...args)),
  };
}

// Whether a URL matches a match pattern such as the all-https pattern or `https://*.example.edu/*`.
export function matchesPattern(pattern: string, url: string): boolean {
  const patternMatch = /^(https?):\/\/([^/]+)\/(.*)$/.exec(pattern);
  if (patternMatch === null) return false;
  const [, scheme, host = '', path = ''] = patternMatch;
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return false;
  }
  if (target.protocol !== `${scheme}:`) return false;
  const hostOk =
    host === '*'
      ? true
      : host.startsWith('*.')
        ? target.hostname === host.slice(2) || target.hostname.endsWith(host.slice(1))
        : target.hostname === host;
  const pathOk = path === '*' || target.pathname.slice(1) === path;
  return hostOk && pathOk;
}

/** Whether a granted pattern covers a requested pattern, such as `https://a.instructure.com/*`. */
function covers(granted: string, requested: string): boolean {
  if (granted === requested) return true;
  return matchesPattern(granted, requested.replace(/\*$/, ''));
}

export interface FakePermissions {
  granted: Set<string>;
  onAdded: FakeEvent<[Browser.permissions.Permissions]>;
  onRemoved: FakeEvent<[Browser.permissions.Permissions]>;
  contains: ReturnType<typeof vi.fn>;
  request: ReturnType<typeof vi.fn>;
  /** Simulates the student granting access in the browser. */
  grant(pattern: string): void;
  /** Simulates the student removing access in the browser. */
  revoke(pattern: string): void;
}

/** Replaces `browser.permissions` with an in-memory fake. */
export function installFakePermissions(initial: string[] = []): FakePermissions {
  const granted = new Set(initial);
  const onAdded = fakeEvent<[Browser.permissions.Permissions]>();
  const onRemoved = fakeEvent<[Browser.permissions.Permissions]>();
  const contains = vi.fn(async (permissions: Browser.permissions.Permissions) =>
    (permissions.origins ?? []).every((origin) =>
      [...granted].some((pattern) => covers(pattern, origin)),
    ),
  );
  const request = vi.fn(async (permissions: Browser.permissions.Permissions) => {
    for (const origin of permissions.origins ?? []) granted.add(origin);
    return true;
  });
  Object.assign(fakeBrowser.permissions, { contains, request, onAdded, onRemoved });
  return {
    granted,
    onAdded,
    onRemoved,
    contains,
    request,
    grant(pattern) {
      granted.add(pattern);
      onAdded.trigger({ origins: [pattern] });
    },
    revoke(pattern) {
      granted.delete(pattern);
      onRemoved.trigger({ origins: [pattern] });
    },
  };
}

export interface FakeScripting {
  executeScript: ReturnType<typeof vi.fn>;
}

/** Replaces `browser.scripting.executeScript` with a spy that resolves to no results. */
export function installFakeScripting(): FakeScripting {
  const executeScript = vi.fn(async () => []);
  Object.assign(fakeBrowser.scripting, { executeScript });
  return { executeScript };
}

export interface FakePort {
  name: string;
  sender: Browser.runtime.MessageSender | undefined;
  postMessage: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  onMessage: FakeEvent<[unknown, FakePort]>;
  onDisconnect: FakeEvent<[FakePort]>;
}

export function fakePort(name: string, sender?: Browser.runtime.MessageSender): FakePort {
  const port: FakePort = {
    name,
    sender,
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    onMessage: fakeEvent<[unknown, FakePort]>(),
    onDisconnect: fakeEvent<[FakePort]>(),
  };
  return port;
}

/** Closes the port from the other end. */
export function closeRemote(port: FakePort): void {
  port.onDisconnect.trigger(port);
}

/** The sender of a panel page, as the background sees it. */
export function panelSender(): Browser.runtime.MessageSender {
  return { id: fakeBrowser.runtime.id, url: fakeBrowser.runtime.getURL('/sidepanel.html') };
}

export interface FakeSidePanel {
  open: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn> | undefined;
}

/** Replaces `browser.sidePanel`. Pass `withClose: false` to model a browser without `close`. */
export function installFakeSidePanel(options: { withClose?: boolean } = {}): FakeSidePanel {
  const open = vi.fn(async () => undefined);
  const close = options.withClose === false ? undefined : vi.fn(async () => undefined);
  Object.assign(fakeBrowser, { sidePanel: close === undefined ? { open } : { open, close } });
  return { open, close };
}

export interface FakeSidebarAction {
  open: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

/** Adds the Firefox `browser.sidebarAction` API. */
export function installFakeSidebarAction(): FakeSidebarAction {
  const api = { open: vi.fn(async () => undefined), close: vi.fn(async () => undefined) };
  Object.assign(fakeBrowser, { sidebarAction: api });
  return api;
}

/** Removes the Firefox `browser.sidebarAction` API again. */
export function removeFakeSidebarAction(): void {
  delete (fakeBrowser as unknown as { sidebarAction?: unknown }).sidebarAction;
}
