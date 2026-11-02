import { render, h } from 'preact';
import { CloseIcon } from '../../shared/ui/icons';
import { browser } from 'wxt/browser';
import { acceptPaneHello, isViewerSecret, secretMessage, validPaneReady } from './channel';
import {
  courseOfLink,
  fileTarget,
  normalizeTabs,
  normalizeWidth,
  openFile,
  plainClick,
  type Tabs,
} from './model';
import type { ToolsSettings } from '../../shared/settings/tools';
import { detectPageTheme } from '../../shared/ui/pageTheme';
import { inpageTheme, type ThemeChoice } from '../../shared/ui/theme';

export function listenViewerHello(
  sourceWindow: Pick<Window, 'addEventListener' | 'removeEventListener'>,
  frame: HTMLIFrameElement,
  extensionId: string,
  connect: (origin: string) => void,
): () => void {
  const hello = (event: MessageEvent) => {
    const origin = acceptPaneHello(event, frame.contentWindow, extensionId);
    if (origin !== null) connect(origin);
  };
  sourceWindow.addEventListener('message', hello);
  return () => sourceWindow.removeEventListener('message', hello);
}

/** How long the pane page has to answer with the secret before the pane closes. */
const HANDSHAKE_MS = 15_000;

export async function startViewer(): Promise<void> {
  // An earlier copy of this script, such as one that an update left behind, stops first. The
  // marker is private to this script, so an element of the page cannot stop the viewer.
  const scope = globalThis as typeof globalThis & { __weekrowViewer?: () => void };
  scope.__weekrowViewer?.();
  const lifetime = new AbortController();
  let live = true;
  const readContext = () =>
    browser.runtime.sendMessage({ type: 'weekrow:page-context' }) as Promise<
      { tools: ToolsSettings; settings?: { theme?: ThemeChoice } } | undefined
    >;
  // `null` when the background did not answer, such as before the first load of the list. The
  // tabs in memory stay as they are then.
  const readTabs = async (): Promise<Tabs | null> => {
    const reply: unknown = await browser.runtime.sendMessage({ type: 'viewer:tabs-get' });
    return typeof reply === 'object' && reply !== null ? normalizeTabs(reply) : null;
  };
  const context = await readContext();
  if (!live || !context?.tools.fileViewer) return;
  let tabs: Tabs = (await readTabs().catch(() => null)) ?? { ids: [], active: null };
  if (!live) return;
  // The pane follows the Theme setting, and with Automatic it follows this Canvas page (decision 19).
  let themeChoice: ThemeChoice = context.settings?.theme ?? 'auto';
  const resolveTheme = () => inpageTheme(themeChoice, () => detectPageTheme(document));
  const applyTheme = () => {
    const theme = resolveTheme();
    host?.setAttribute('data-theme', theme);
    port?.postMessage({ type: 'theme', theme });
  };
  let width = normalizeWidth(context.tools.fileViewerWidth, innerWidth);
  let host: HTMLDivElement | undefined;
  // The port of the pane once it proved the secret, and a port that waits for that proof.
  let port: MessagePort | undefined;
  let pending: MessagePort | undefined;
  let opening = false;
  let padding = '';
  let priority = '';
  const layout = () => {
    if (!host) return;
    host.style.width = innerWidth < 900 ? '100vw' : `${normalizeWidth(width, innerWidth)}px`;
    if (innerWidth < 900) {
      document.documentElement.style.setProperty('padding-right', padding, priority);
    } else {
      document.documentElement.style.setProperty('padding-right', host.style.width, 'important');
    }
  };
  // The course the student opened each file from, for the "Open in Canvas" link.
  const courses = new Map<string, string>();
  // Sends the active file. The pane changes the tabs too, so the stored tabs are read again.
  const send = async () => {
    const [latest, stored] = await Promise.all([
      readContext().catch(() => undefined),
      readTabs().catch(() => null),
    ]);
    if (latest?.settings?.theme) themeChoice = latest.settings.theme;
    tabs = stored ?? tabs;
    applyTheme();
    const courseId = tabs.active === null ? undefined : courses.get(tabs.active);
    if (tabs.active)
      port?.postMessage({
        type: 'open-file',
        fileId: tabs.active,
        ...(courseId ? { courseId } : {}),
      });
  };
  let removeHello: (() => void) | undefined;
  let handshake: ReturnType<typeof setTimeout> | undefined;
  let lastHelloAt = -Infinity;
  /** Removes the pane and gives the page its padding back. The stored tabs stay. */
  const drop = () => {
    clearTimeout(handshake);
    handshake = undefined;
    removeHello?.();
    removeHello = undefined;
    host?.remove();
    host = undefined;
    pending?.close();
    pending = undefined;
    port?.close();
    port = undefined;
    document.documentElement.style.setProperty('padding-right', padding, priority);
  };
  const close = () => {
    drop();
    tabs = { ids: [], active: null };
    void browser.runtime.sendMessage({ type: 'viewer:tabs-set', tabs });
  };
  // A page can remove the host. Then no pane is open, and the next click opens a new one.
  const paneOpen = () => {
    if (host && !host.isConnected) drop();
    return host !== undefined;
  };
  const show = async () => {
    if (paneOpen()) {
      void send();
      return;
    }
    if (opening) return;
    opening = true;
    // The background makes the secret of this pane. Only this script and the pane page get it, so
    // it is in no address and in no window message. The frame loads after the secret is stored.
    let secret: string;
    try {
      const session = (await browser.runtime.sendMessage({ type: 'viewer:session' })) as
        { secret?: unknown } | undefined;
      if (!isViewerSecret(session?.secret)) return;
      secret = session.secret;
    } catch {
      return;
    } finally {
      opening = false;
    }
    padding = document.documentElement.style.getPropertyValue('padding-right');
    priority = document.documentElement.style.getPropertyPriority('padding-right');
    host = document.createElement('div');
    host.id = 'tools-file-viewer';
    host.style.cssText = 'position:fixed;right:0;top:0;height:100vh;z-index:2147483647;';
    // A closed root keeps a script of the Canvas page from reaching the frame element.
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>
      :host{--bg:#fff;--text:#273540;--line:#e8eaec;--edge:#c7cdd1;--hover:#f2f4f4;--focus:#0374b5;color:var(--text)}
      :host([data-theme='dark']){--bg:#1b2330;--text:#fff;--line:#2e3e4e;--edge:#4a5b68;--hover:#253443;--focus:#5a9fd4}
      section{box-sizing:border-box;height:100%;background:var(--bg);border-left:1px solid var(--edge);display:flex;flex-direction:column;font-family:Lato,Arial,sans-serif}
      header{flex:none;height:56px;display:flex;justify-content:flex-end;align-items:center;padding:0 12px;border-bottom:1px solid var(--line)}
      button{width:38px;height:38px;border:0;border-radius:4px;background:transparent;color:inherit;font-size:18px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer}button:hover{background:var(--hover)}button:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
      iframe{border:0;width:100%;flex:1;min-height:0;background:transparent} .handle{position:absolute;left:-4px;top:0;width:8px;height:100%;cursor:ew-resize;touch-action:none}.handle:hover,.handle:focus-visible{background:var(--focus)} @media(max-width:899px){.handle{display:none}}
      </style><section aria-label="File viewer"><div class="handle" role="separator" aria-label="Resize file viewer" aria-orientation="vertical" tabindex="0"></div><header><button aria-label="Close file viewer" title="Close"></button></header></section>`;
    const frame = document.createElement('iframe');
    frame.title = 'File viewer';
    frame.src = browser.runtime.getURL('/viewer.html');
    // The pane page says hello first, so the port goes to the origin the frame really has.
    // Chromium can load a web-accessible page under a dynamic address that differs from getURL.
    // The port counts only after the pane answers with the secret.
    const answerInTime = () => {
      clearTimeout(handshake);
      handshake = setTimeout(() => {
        if (host && !port) close();
      }, HANDSHAKE_MS);
    };
    removeHello = listenViewerHello(window, frame, browser.runtime.id, (origin) => {
      lastHelloAt = performance.now();
      pending?.close();
      port?.close();
      port = undefined;
      answerInTime();
      const channel = new MessageChannel();
      const candidate = channel.port1;
      pending = candidate;
      candidate.onmessage = (message) => {
        if (port === candidate) {
          if ((message.data as { type?: unknown } | null)?.type === 'close') close();
          return;
        }
        if (pending !== candidate) return;
        pending = undefined;
        if (!validPaneReady(message.data, secret)) {
          candidate.close();
          return;
        }
        port = candidate;
        clearTimeout(handshake);
        applyTheme();
        void send();
      };
      frame.contentWindow?.postMessage({ type: 'viewer-connect' }, origin, [channel.port2]);
      candidate.postMessage(secretMessage(secret));
    });
    // Every load of the frame after the first is a new document, and it must say hello again. The
    // hello can come a moment before the load event, so a hello shortly before the load counts.
    // The hello replaces the port of the document before it. If no hello follows, the pane closes.
    let loads = 0;
    frame.addEventListener('load', () => {
      loads += 1;
      if (loads === 1) return;
      const loadedAt = performance.now();
      clearTimeout(handshake);
      handshake = setTimeout(() => {
        if (host && lastHelloAt < loadedAt - 2000) close();
      }, HANDSHAKE_MS);
    });
    render(h(CloseIcon, {}), root.querySelector('button')!);
    root.querySelector('section')!.append(frame);
    root.querySelector('button')!.addEventListener('click', close);
    root.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Escape') close();
    });
    const handle = root.querySelector<HTMLElement>('.handle')!;
    const save = async () => {
      const latest = (await browser.runtime.sendMessage({ type: 'weekrow:page-context' })) as {
        tools: ToolsSettings;
      };
      await browser.runtime.sendMessage({
        type: 'weekrow:save-tools',
        tools: { ...latest.tools, fileViewerWidth: width },
      });
    };
    handle.addEventListener('pointerdown', (event) => {
      handle.setPointerCapture(event.pointerId);
      const move = (event: PointerEvent) => {
        width = normalizeWidth(innerWidth - event.clientX, innerWidth);
        layout();
      };
      const end = () => {
        handle.removeEventListener('pointermove', move);
        void save();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', end, { once: true });
    });
    handle.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      width = normalizeWidth(width + (event.key === 'ArrowLeft' ? 20 : -20), innerWidth);
      layout();
      void save();
    });
    document.body.append(host);
    applyTheme();
    layout();
    answerInTime();
  };
  window.addEventListener('resize', layout, { signal: lifetime.signal });
  // The background says when a setting changed, so the pane follows the Theme setting at once.
  const onChanged = (message: unknown) => {
    if ((message as { type?: unknown } | null)?.type !== 'weekrow:changed') return;
    void readContext().then(
      (latest) => {
        const choice = latest?.settings?.theme;
        if (choice && choice !== themeChoice) {
          themeChoice = choice;
          applyTheme();
        }
      },
      () => undefined,
    );
  };
  browser.runtime.onMessage.addListener(onChanged);
  document.addEventListener(
    'click',
    (event) => {
      if (!plainClick(event) || !(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLElement>(
        'a[href],button[data-file-id],button[data-url]',
      );
      if (!link || link.hasAttribute('download')) return;
      const module = link.closest('[data-module-id],.context_module');
      const moduleId =
        module?.getAttribute('data-module-id') ?? module?.id.replace('context_module_', '');
      const href =
        link.getAttribute('href') ??
        link.dataset['url'] ??
        `/files/${link.dataset['fileId'] ?? ''}`;
      const target = fileTarget(href, location.origin, moduleId);
      if (!target) return;
      if (
        'itemId' in target &&
        !link.closest('.attachment,.file,[data-type="File"],[data-module-type="File"]')
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void (async () => {
        const file =
          'fileId' in target
            ? target
            : ((await browser.runtime.sendMessage({ type: 'viewer:module-item', ...target })) as
                { fileId: string } | undefined);
        if (!file) return;
        const courseId =
          'courseId' in target ? target.courseId : courseOfLink(href, location.origin);
        if (courseId) courses.set(file.fileId, courseId);
        if (paneOpen() && port) {
          // The pane is open and owns the tabs, so it opens the file and saves the tabs itself.
          port.postMessage({
            type: 'open-file',
            fileId: file.fileId,
            ...(courseId ? { courseId } : {}),
          });
          return;
        }
        tabs = openFile((await readTabs().catch(() => null)) ?? tabs, file.fileId);
        await browser.runtime.sendMessage({ type: 'viewer:tabs-set', tabs });
        await show();
      })().catch(() => undefined);
    },
    { capture: true, signal: lifetime.signal },
  );
  scope.__weekrowViewer = () => {
    live = false;
    lifetime.abort();
    browser.runtime.onMessage.removeListener(onChanged);
    drop();
  };
  if (tabs.active) void show();
}
