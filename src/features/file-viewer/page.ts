import { browser, type Browser } from 'wxt/browser';
import { t } from '../../shared/ui/i18n';
import { createDock, type Dock } from './dock';
import { TOP_OPEN } from './frame';
import { acceptPaneHello, isViewerSecret, secretMessage, validPaneReady } from './channel';
import {
  clickedElement,
  KEEP_ACTION_ATTRIBUTE,
  courseOfLink,
  fileTarget,
  catchesDownload,
  isCommentTab,
  isFileId,
  isSubmissionPage,
  linkName,
  normalizeTabs,
  normalizeWidth,
  openFile,
  plainClick,
  type FileTarget,
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
  // An earlier copy of this script, such as one that an update left behind or one that starts at
  // the same time, stops first. The marker is private to this script, so an element of the page
  // cannot stop the viewer. The new copy sets its own teardown before it waits for anything.
  const scope = globalThis as typeof globalThis & { __weekrowViewer?: () => void };
  scope.__weekrowViewer?.();
  const lifetime = new AbortController();
  let live = true;
  let enabled = false;
  const readContext = () =>
    browser.runtime.sendMessage({ type: 'weekrow:page-context' }) as Promise<
      { tools: ToolsSettings; settings?: { theme?: ThemeChoice } } | undefined
    >;
  // `null` when the background did not answer, such as before the first load of the list. The
  // tabs in memory stay as they are then. The token comes with the tabs and goes back with a
  // write, so the background can refuse a write for tabs that it has cleared since.
  const readTabs = async (): Promise<{ tabs: Tabs; token: string | undefined } | null> => {
    const reply: unknown = await browser.runtime.sendMessage({ type: 'viewer:tabs-get' });
    if (typeof reply !== 'object' || reply === null) return null;
    const token = (reply as { token?: unknown }).token;
    return { tabs: normalizeTabs(reply), token: typeof token === 'string' ? token : undefined };
  };
  const writeTabs = (next: Tabs) =>
    browser.runtime.sendMessage({ type: 'viewer:tabs-set', tabs: next, token: tabsToken });
  let tabs: Tabs = { ids: [], active: null };
  let tabsToken: string | undefined;
  // The pane follows the Theme setting, and with Automatic it follows this Canvas page (decision 19).
  let themeChoice: ThemeChoice = 'auto';
  const resolveTheme = () => inpageTheme(themeChoice, () => detectPageTheme(document));
  const applyTheme = () => {
    const theme = resolveTheme();
    dock?.setTheme(theme);
    port?.postMessage({ type: 'theme', theme });
  };
  let width = normalizeWidth(undefined, innerWidth);
  let dock: Dock | undefined;
  // The port of the pane once it proved the secret, and a port that waits for that proof.
  let port: MessagePort | undefined;
  let pending: MessagePort | undefined;
  // The course the student opened each file from, for the "Open in Canvas" link.
  const courses = new Map<string, string>();
  // The text of the link of each comment attachment that the student opened, for its tab name.
  const names = new Map<string, string>();
  const openMessage = (fileId: string) => {
    const courseId = courses.get(fileId);
    const name = names.get(fileId);
    return {
      type: 'open-file' as const,
      fileId,
      ...(courseId ? { courseId } : {}),
      ...(name ? { name } : {}),
    };
  };
  // Whether the pane of the current port has been told what to open. The first open-file request
  // makes the pane restore the stored tabs, and from then on the pane owns the tabs: a stored
  // copy is older than the pane, so it never goes out again, or it would undo what the student
  // did in the pane since.
  let synced = false;
  // Sends the active file to a pane that has not been told yet, and the theme to any pane.
  const send = async () => {
    const [latest, stored] = await Promise.all([
      readContext().catch(() => undefined),
      readTabs().catch(() => null),
    ]);
    if (!live) return;
    if (latest?.settings?.theme) themeChoice = latest.settings.theme;
    if (stored) {
      tabs = stored.tabs;
      tabsToken = stored.token;
    }
    applyTheme();
    if (tabs.active && port && !synced) {
      synced = true;
      port.postMessage(openMessage(tabs.active));
    }
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
    pending?.close();
    pending = undefined;
    port?.close();
    port = undefined;
    dock?.close();
    dock = undefined;
  };
  const save = async () => {
    const latest = (await browser.runtime.sendMessage({ type: 'weekrow:page-context' })) as {
      tools: ToolsSettings;
    };
    await browser.runtime.sendMessage({
      type: 'weekrow:save-tools',
      tools: { ...latest.tools, fileViewerWidth: width },
    });
  };
  const close = () => {
    drop();
    tabs = { ids: [], active: null };
    void writeTabs(tabs);
  };
  // A page can remove the host. Then no pane is open, and the next click opens a new one.
  const paneOpen = () => {
    if (dock && !dock.host.isConnected) drop();
    return dock !== undefined;
  };
  // Opens the pane. A call while another one is in progress waits for the same open.
  let showing: Promise<void> | undefined;
  const show = (): Promise<void> => {
    showing ??= showNow().finally(() => {
      showing = undefined;
    });
    return showing;
  };
  const showNow = async () => {
    if (!live) return;
    if (paneOpen()) {
      void send();
      return;
    }
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
    }
    if (!live) return;
    lastHelloAt = -Infinity;
    const created = createDock({
      role: 'file',
      id: 'tools-file-viewer',
      label: 'File viewer',
      resizeLabel: 'Resize file viewer',
      width,
      onResized(next) {
        width = next;
        void save();
      },
    });
    dock = created;
    const root = created.root;
    const earlyClose = document.createElement('button');
    earlyClose.type = 'button';
    earlyClose.textContent = '×';
    earlyClose.setAttribute('aria-label', t('fileViewerClose'));
    earlyClose.style.cssText =
      'position:absolute;right:8px;top:4px;width:32px;height:32px;z-index:1;color:var(--text);background:var(--bg);border:0;cursor:pointer';
    earlyClose.addEventListener('click', close);
    created.section.append(earlyClose);
    const frame = document.createElement('iframe');
    frame.title = 'File viewer';
    frame.allow = 'clipboard-write *';
    frame.src = browser.runtime.getURL('/viewer.html');
    // The pane page says hello first, so the port goes to the origin the frame really has.
    // Chromium can load a web-accessible page under a dynamic address that differs from getURL.
    // The port counts only after the pane answers with the secret.
    const answerInTime = () => {
      clearTimeout(handshake);
      handshake = setTimeout(() => {
        if (dock && !port) drop();
      }, HANDSHAKE_MS);
    };
    removeHello = listenViewerHello(window, frame, browser.runtime.id, (origin) => {
      lastHelloAt = performance.now();
      pending?.close();
      port?.close();
      port = undefined;
      earlyClose.hidden = false;
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
        synced = false;
        earlyClose.hidden = true;
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
        if (dock && lastHelloAt < loadedAt - 2000) drop();
      }, HANDSHAKE_MS);
    });
    created.section.append(frame);
    root.addEventListener('keydown', (event) => {
      // A frame of the Canvas page can reach this root, so only a real key counts.
      if (event.isTrusted && (event as KeyboardEvent).key === 'Escape') close();
    });
    created.open();
    applyTheme();
    answerInTime();
  };
  scope.__weekrowViewer = () => {
    live = false;
    lifetime.abort();
    drop();
  };
  // The opens run one after another. Each one reads the stored tabs, adds its file and writes them
  // back, so two that ran side by side would both start from the same tabs and the second write
  // would drop the file of the first. The tab order is also the order of the clicks.
  let opens: Promise<unknown> = Promise.resolve();
  const openTarget = (target: FileTarget, href: string): Promise<boolean> => {
    const run = opens.then(() => openNow(target, href));
    opens = run.catch(() => undefined);
    return run;
  };
  /**
   * Opens a file in the pane: resolves a module item to its file, then adds the tab. It resolves
   * to whether the pane has the file or is about to get it.
   */
  const openNow = async (target: FileTarget, href: string): Promise<boolean> => {
    // A turn-in may have covered the pane. A file shows the pane again.
    if (paneOpen()) dock?.setHidden(false);
    if (!paneOpen()) await show();
    const file =
      'fileId' in target
        ? target
        : ((await browser.runtime.sendMessage({ type: 'viewer:module-item', ...target })) as
            { fileId: string } | undefined);
    if (!file || !paneOpen()) return false;
    const courseId = 'courseId' in target ? target.courseId : courseOfLink(href, location.origin);
    if (courseId) courses.set(file.fileId, courseId);
    const open = () => {
      // The pane is open and owns the tabs, so it opens the file and saves the tabs itself. This
      // request also makes a pane that has not been told yet restore the stored tabs.
      synced = true;
      port?.postMessage(openMessage(file.fileId));
      return true;
    };
    if (paneOpen() && port) return open();
    const stored = await readTabs().catch(() => null);
    if (!live) return false;
    if (stored) tabsToken = stored.token;
    tabs = openFile(stored?.tabs ?? tabs, file.fileId);
    await writeTabs(tabs);
    // The pane may have connected while the tabs were written. It owns them from then on, and
    // it has not seen this file, so it gets the file as a request, never as a copy of the store.
    if (paneOpen() && port) return open();
    await show();
    return paneOpen();
  };
  document.addEventListener(
    'click',
    (event) => {
      const clicked = clickedElement(event);
      if (!plainClick(event) || clicked === null) return;
      const link = clicked.closest<HTMLElement>('a[href],button[data-file-id],button[data-url]');
      if (!link || link.closest(`[${KEEP_ACTION_ATTRIBUTE}]`) !== null) return;
      const module = link.closest('[data-module-id],.context_module');
      const moduleId =
        module?.getAttribute('data-module-id') ?? module?.id.replace('context_module_', '');
      const href =
        link.getAttribute('href') ??
        link.dataset['url'] ??
        `/files/${link.dataset['fileId'] ?? ''}`;
      // A link with a download attribute keeps its action, except a file the student handed in.
      if (
        link.hasAttribute('download') &&
        !catchesDownload(link, href, location.origin, location.pathname)
      )
        return;
      const target = fileTarget(href, location.origin, moduleId);
      if (!target) return;
      if (
        'itemId' in target &&
        !link.closest('.attachment,.file,[data-type="File"],[data-module-type="File"]')
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if ('fileId' in target && isCommentTab(target.fileId)) {
        const name = linkName(link.textContent);
        if (name) names.set(target.fileId, name);
      }
      const checkedHref = link.getAttribute('href');
      void (async () => {
        // The click is taken at once, even while the settings and the tabs are still loading.
        await starting;
        if (!live) return;
        if (!enabled) {
          // The viewer is off, so the click goes to the link after all. The click that the script
          // makes is not trusted, so the listener above ignores it, and the browser does what the
          // link says: it follows the link, saves a download, or opens a new tab.
          // A page script that changed the link in the meantime gets no click on the new address.
          if (link.isConnected && link.getAttribute('href') === checkedHref) link.click();
          return;
        }
        await openTarget(target, href);
      })().catch(() => undefined);
    },
    { capture: true, signal: lifetime.signal },
  );
  // The settings and the stored tabs load while the listeners above already work.
  const starting = (async () => {
    const context = await readContext();
    if (!live || !context?.tools.fileViewer) return;
    themeChoice = context.settings?.theme ?? 'auto';
    width = normalizeWidth(context.tools.fileViewerWidth, innerWidth);
    const stored = await readTabs().catch(() => null);
    if (!live) return;
    if (stored) {
      tabs = stored.tabs;
      tabsToken = stored.token;
    }
    enabled = true;
  })().catch(() => undefined);
  // The background sends two kinds of message to this script. It says when a setting changed, so
  // the pane follows the Theme setting at once. And it passes on a file that the click catcher
  // took in the frame of the submission details page, whose files list this script cannot see
  // (frame.ts, decision 25, item 11).
  const onBackground = (
    message: unknown,
    sender: Browser.runtime.MessageSender,
    respond: (reply: { opened: boolean }) => void,
  ): boolean | undefined => {
    const request = message as { type?: unknown; fileId?: unknown } | null;
    if (request?.type === 'weekrow:changed') {
      void readContext().then(
        (latest) => {
          const choice = latest?.settings?.theme;
          if (choice && choice !== themeChoice) {
            themeChoice = choice;
            applyTheme();
          }
          // The turn-in pane shares the width, and it may have saved a new one.
          if (latest?.tools.fileViewerWidth !== undefined) {
            width = normalizeWidth(latest.tools.fileViewerWidth, innerWidth);
            dock?.setWidth(width);
          }
        },
        () => undefined,
      );
      return undefined;
    }
    if (request?.type !== TOP_OPEN) return undefined;
    // A page cannot send a runtime message to a content script. The sender is the background.
    if (sender.id !== browser.runtime.id || sender.tab !== undefined || !isFileId(request.fileId)) {
      respond({ opened: false });
      return undefined;
    }
    const fileId = request.fileId;
    void (async () => {
      await starting;
      // The catcher saves the file in the usual way unless the pane has it, so the answer comes
      // after the open.
      respond({ opened: live && enabled && (await openTarget({ fileId }, `/files/${fileId}`)) });
    })().catch(() => respond({ opened: false }));
    return true;
  };
  browser.runtime.onMessage.addListener(onBackground);
  lifetime.signal.addEventListener(
    'abort',
    () => browser.runtime.onMessage.removeListener(onBackground),
    { once: true },
  );
  await starting;
  if (live && !enabled) {
    // The viewer is off. A click that came before this point still finds `live`, and follows its link.
    lifetime.abort();
  }
  if (live && enabled && isSubmissionPage(location.pathname)) {
    // Every load of the frame is a new document, which needs its own catcher. A script of the
    // page can fire a load event, so only a trusted one counts.
    // One ask at a time, and one more after it when a load came meanwhile. A page that loads its
    // frame again and again cannot make the background probe the tab more often than it can answer.
    let asking = false;
    let askAgain = false;
    const askForCatcher = () => {
      if (asking) {
        askAgain = true;
        return;
      }
      asking = true;
      void browser.runtime
        .sendMessage({ type: 'viewer:inject-frames' })
        .catch(() => undefined)
        .finally(() => {
          asking = false;
          if (askAgain && live) {
            askAgain = false;
            askForCatcher();
          }
        });
    };
    document.addEventListener(
      'load',
      (event) => {
        if (
          event.isTrusted &&
          event.target instanceof HTMLIFrameElement &&
          event.target.id === 'preview_frame'
        )
          askForCatcher();
      },
      { capture: true, signal: lifetime.signal },
    );
    askForCatcher();
  }
  if (live && enabled && tabs.active) void show();
}
