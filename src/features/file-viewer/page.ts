import { fileLinks } from './ui/links';
import { watchPaneReset } from './paneReset';
import { browser, type Browser } from 'wxt/browser';
import { t } from '../../shared/ui/i18n';
import {
  FILE_HOST_ID,
  fullViewAvailable,
  isFullView,
  removeStaleFilePane,
  reportFilePane,
  setFullView,
  watchFilePane,
  watchFullView,
} from './dock';
import { createCardDock, type CardDock } from './cardDock';
import { TOP_OPEN } from './frame';
import {
  acceptPaneHello,
  isViewerSecret,
  secretMessage,
  validPaneReady,
  validPaneRequest,
} from './channel';
import {
  clickedElement,
  courseOfLink,
  fileTarget,
  catchesDownload,
  isCommentTab,
  isFileId,
  isSubmissionPage,
  keptAddress,
  linkName,
  normalizeTabs,
  openFile,
  plainClick,
  type FileTarget,
  type Tabs,
} from './model';
import { normalizeWidth } from './width';
import type { ToolsSettings } from '../../shared/settings/tools';
import { detectPageTheme, watchPageTheme } from '../../shared/ui/pageTheme';
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

/** The message that the background sends to every tab when it clears the data of a student. */

/** What an open of a file came to. See `openNow`. */
type OpenResult = 'opened' | 'ended' | 'failed' | 'timeout';

/** How long the pane page has to answer with the secret before the pane closes. */
const HANDSHAKE_MS = 15_000;

export async function startViewer(): Promise<void> {
  // An earlier copy of this script, such as one that an update left behind or one that starts at
  // the same time, stops first. The marker is private to this script, so an element of the page
  // cannot stop the viewer. The new copy sets its own teardown before it waits for anything.
  const scope = globalThis as typeof globalThis & { __weekrowViewer?: () => void };
  scope.__weekrowViewer?.();
  // A copy that an update ended with its pane open left a host and the room beside it. This copy
  // has no pane yet, so any host with the mark of a dock is stale.
  removeStaleFilePane();
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
  // The pane page cannot read the state of the Canvas page, so it gets the full view state here.
  const sendFullView = () =>
    port?.postMessage({ type: 'full-view', on: isFullView(), available: fullViewAvailable() });
  // Another pane may hide the file pane. The pane page is told, because it cannot see that: its
  // tabs pause their media and keep their place while the pane is hidden.
  const sendCovered = () =>
    port?.postMessage({
      type: 'covered',
      covered:
        dock !== undefined &&
        (!dock.shown || dock.host.getAttribute('data-identity') === 'unknown'),
    });
  let width = normalizeWidth(undefined);
  let dock: CardDock | undefined;
  // The port of the pane once it proved the secret, and a port that waits for that proof.
  let port: MessagePort | undefined;
  let pending: MessagePort | undefined;
  // The course the student opened each file from, for the "Open in Canvas" link.
  const courses = new Map<string, string>();
  // The text of the link of each comment attachment that the student opened, for its tab name.
  const names = new Map<string, string>();
  // The address of the last click on each file whose link carried a `verifier` or a `location`.
  // The pane shows it as the "Open in Canvas" link of its error card. It lives in this memory
  // only, goes with a reset, is written nowhere and read by nobody.
  const addresses = new Map<string, string>();
  const openMessage = (fileId: string) => {
    const courseId = courses.get(fileId);
    const name = names.get(fileId);
    const address = addresses.get(fileId);
    return {
      type: 'open-file' as const,
      fileId,
      ...(courseId ? { courseId } : {}),
      ...(name ? { name } : {}),
      ...(address ? { address } : {}),
    };
  };
  // Whether the pane of the current port has been told what to open. The first open-file request
  // makes the pane restore the stored tabs, and from then on the pane owns the tabs: a stored
  // copy is older than the pane, so it never goes out again, or it would undo what the student
  // did in the pane since.
  let synced = false;
  // The file of an open that has not reached the pane yet.
  let waitingFile: string | null = null;
  const addedTabs = new Set<string>();
  let failureAddress = '';
  let failedConnection = false;
  /** The address of a file or a comment attachment in Canvas. */
  const canvasAddress = (id: string, courseId: string | null | undefined = courses.get(id)) => {
    const links = fileLinks(location.origin, id, courseId);
    return links?.canvas ?? links!.download;
  };
  const connectionFailed = () => {
    failedConnection = true;
    clearTimeout(handshake);
    removeHello?.();
    removeHello = undefined;
    pending?.close();
    pending = undefined;
    port?.close();
    port = undefined;
    const address = failureAddress || (tabs.active ? canvasAddress(tabs.active) : location.origin);
    const ids = tabs.ids.filter((id) => !addedTabs.has(id));
    tabs = {
      ids,
      active: tabs.active && ids.includes(tabs.active) ? tabs.active : (ids.at(-1) ?? null),
    };
    addedTabs.clear();
    waitingFile = null;
    dock?.showFailure(address);
    settleConnection?.('timeout');
    settleConnection = undefined;
  };
  // Sends the active file to a pane that has not been told yet, and the theme to any pane.
  const send = async () => {
    const started = generation;
    const [latest, stored] = await Promise.all([
      readContext().catch(() => undefined),
      readTabs().catch(() => null),
    ]);
    if (!live || generation !== started) return;
    if (latest?.settings?.theme) themeChoice = latest.settings.theme;
    if (stored) {
      const next = [...addedTabs].reduce(openFile, stored.tabs);
      tabs = waitingFile ? openFile(next, waitingFile) : next;
      tabsToken = stored.token;
    }
    // The pane has connected, so the files of the clicks that waited for it join the stored tabs,
    // and the pane restores them.
    if (port && addedTabs.size > 0) {
      await writeTabs(tabs).catch(() => undefined);
      if (!live || generation !== started) return;
      addedTabs.clear();
    }
    applyTheme();
    sendFullView();
    sendCovered();
    if (tabs.active && port && !synced) {
      synced = true;
      waitingFile = null;
      port.postMessage(openMessage(tabs.active));
    }
  };
  let removeHello: (() => void) | undefined;
  let handshake: ReturnType<typeof setTimeout> | undefined;
  let lastHelloAt = -Infinity;
  let connection: Promise<OpenResult> | undefined;
  let settleConnection: ((result: OpenResult) => void) | undefined;
  const waitForConnection = () => {
    if (settleConnection) return;
    connection = new Promise((resolve) => {
      settleConnection = resolve;
    });
  };
  /** Removes the pane and gives the page its padding back. The stored tabs stay. */
  const drop = (result: OpenResult = 'ended') => {
    settleConnection?.(result);
    settleConnection = undefined;
    connection = undefined;
    failedConnection = false;
    waitingFile = null;
    addedTabs.clear();
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
  // The background cleared the data of a student: a sign-out, another student or a new address.
  // The pane closes, also a pane that another pane covers, and nothing of the earlier student
  // stays in this page: not the tabs, not the course or the name of a file. The background holds
  // no tabs any more, so nothing is written.
  // An open that started before the reset belongs to the earlier student and ends without a pane,
  // so `generation` counts the resets.
  let generation = 0;
  const reset = () => {
    generation += 1;
    showing = undefined;
    drop();
    tabs = { ids: [], active: null };
    tabsToken = undefined;
    synced = false;
    courses.clear();
    names.clear();
    addresses.clear();
  };
  const stopReset = watchPaneReset(reset);
  lifetime.signal.addEventListener('abort', stopReset, { once: true });
  // A page can remove the host. Then no pane is open, and the next click opens a new one.
  const paneOpen = () => {
    if (dock && !dock.host.isConnected) drop();
    return dock !== undefined;
  };
  // Opens the pane. A call while another one is in progress waits for the same open.
  let showing: Promise<void> | undefined;
  const show = (): Promise<void> => {
    if (showing === undefined) {
      const run: Promise<void> = showNow(generation).finally(() => {
        if (showing === run) showing = undefined;
      });
      showing = run;
    }
    return showing;
  };
  const showNow = async (started: number) => {
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
    if (!live || generation !== started) return;
    lastHelloAt = -Infinity;
    waitForConnection();
    const created = createCardDock({
      role: 'file',
      onClose: close,
      identityToken: tabsToken,
      onIdentityChange: sendCovered,
      id: FILE_HOST_ID,
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
        if (dock && !port) connectionFailed();
      }, HANDSHAKE_MS);
    };
    removeHello = listenViewerHello(window, frame, browser.runtime.id, (origin) => {
      lastHelloAt = performance.now();
      waitForConnection();
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
          if (!validPaneRequest(message.data)) return;
          // Escape leaves full view first, and a narrow window has none. Full view ends with the
          // close of a pane (see `createDock`).
          if (message.data.type === 'full-view') setFullView(message.data.on);
          else if (message.data.type === 'escape' && created.full) setFullView(false);
          else close();
          return;
        }
        if (pending !== candidate) return;
        pending = undefined;
        if (!validPaneReady(message.data, secret)) {
          candidate.close();
          return;
        }
        port = candidate;
        settleConnection?.('opened');
        settleConnection = undefined;
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
      if (lastHelloAt < loadedAt - 2000) {
        port?.close();
        port = undefined;
        waitForConnection();
      }
      clearTimeout(handshake);
      handshake = setTimeout(() => {
        if (dock && lastHelloAt < loadedAt - 2000) connectionFailed();
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
  const teardown = () => {
    live = false;
    lifetime.abort();
    drop();
    // A later start has no stale teardown to call.
    if (scope.__weekrowViewer === teardown) delete scope.__weekrowViewer;
  };
  scope.__weekrowViewer = teardown;
  // The pane follows full view, and the width of the window decides whether the button shows.
  const stopWatchingFullView = watchFullView(sendFullView);
  const stopWatchingPanes = watchFilePane(sendCovered);
  addEventListener('resize', sendFullView, { signal: lifetime.signal });
  lifetime.signal.addEventListener('abort', stopWatchingFullView, { once: true });
  lifetime.signal.addEventListener('abort', stopWatchingPanes, { once: true });
  // Canvas turns its dark mode on and off with no reload, and Automatic follows it.
  lifetime.signal.addEventListener('abort', watchPageTheme(document, applyTheme), { once: true });
  // The opens run one after another. Each one reads the stored tabs, adds its file and writes them
  // back, so two that ran side by side would both start from the same tabs and the second write
  // would drop the file of the first. The tab order is also the order of the clicks.
  let opens: Promise<unknown> = Promise.resolve();
  // The opens that wait or run, and the clicks that the script took. The newest click wins.
  let waitingOpens = 0;
  let clicks = 0;
  // The pane came from an open that has not given it a file yet.
  let emptyPane = false;
  const openTarget = (target: FileTarget, href: string, taken: number): Promise<OpenResult> => {
    waitingOpens += 1;
    const run = opens
      .then(() => openNow(target, href, taken))
      .finally(() => {
        waitingOpens -= 1;
      });
    opens = run.catch(() => undefined);
    // The tab writes stay ordered while each caller waits separately for the frame to connect.
    return run.then((result) => (typeof result === 'string' ? result : result.connected));
  };
  /**
   * Opens a file in the pane: resolves a module item to its file, then adds the tab. It resolves
   * to `opened` when the connected pane can take the file, to `ended` when the student
   * closed the pane or a reset came, and to `failed` when the pane could not take the file.
   */
  const openNow = async (
    target: FileTarget,
    href: string,
    started: number,
  ): Promise<OpenResult | { connected: Promise<OpenResult> }> => {
    const ended = () => !live || generation !== started;
    if (ended()) return 'ended';
    if (failedConnection) drop();
    // Callers have checked this target against the Canvas origin.
    failureAddress = keptAddress(href, location.origin) ?? new URL(href, location.origin).href;
    if (paneOpen()) {
      // A turn-in may have covered the pane. A file shows the pane again.
      dock?.setHidden(false);
    } else {
      await show();
      emptyPane = true;
    }
    if (ended()) return 'ended';
    if (!paneOpen()) return 'failed';
    const connected = connection;
    const file =
      'fileId' in target
        ? target
        : ((await browser.runtime
            .sendMessage({ type: 'viewer:module-item', ...target })
            .catch(() => undefined)) as { fileId: string } | undefined);
    if (ended()) return 'ended';
    if (failedConnection) return connected ? { connected } : 'timeout';
    if (!paneOpen()) return connected ? { connected } : 'failed';
    if (!file) {
      // A pane that only this kind of open made has no file to show, and no open behind it will
      // give it one. A pane that shows a file stays.
      if (emptyPane && !synced && waitingOpens === 1) drop();
      return 'failed';
    }
    emptyPane = false;
    const courseId = 'courseId' in target ? target.courseId : courseOfLink(href, location.origin);
    if (courseId) courses.set(file.fileId, courseId);
    failureAddress =
      addresses.get(file.fileId) ??
      keptAddress(href, location.origin) ??
      canvasAddress(file.fileId, courseId);
    const open = () => {
      // The pane is open and owns the tabs, so it opens the file and saves the tabs itself. This
      // request also makes a pane that has not been told yet restore the stored tabs.
      synced = true;
      waitingFile = null;
      addedTabs.clear();
      port?.postMessage(openMessage(file.fileId));
      return 'opened' as const;
    };
    if (paneOpen() && port) return open();
    const stored = await readTabs().catch(() => null);
    if (ended()) return 'ended';
    if (failedConnection) return connected ? { connected } : 'timeout';
    if (stored) tabsToken = stored.token;
    const previous = [...addedTabs].reduce(openFile, stored?.tabs ?? tabs);
    if (!previous.ids.includes(file.fileId)) addedTabs.add(file.fileId);
    tabs = openFile(previous, file.fileId);
    // The file stays out of the stored tabs until the pane connects, so a failed open leaves
    // nothing that brings the pane back on the next page.
    waitingFile = file.fileId;
    // The pane may have connected during the read. It owns the tabs from then on, and it has not
    // seen this file, so it gets the file as a request, never as a copy of the store.
    if (paneOpen() && port) return open();
    return connected ? { connected } : 'failed';
  };
  document.addEventListener(
    'click',
    (event) => {
      const clicked = clickedElement(event);
      if (!plainClick(event) || clicked === null) return;
      const link = clicked.closest<HTMLElement>('a[href],button[data-file-id],button[data-url]');
      if (!link) return;
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
      if ('fileId' in target) {
        const address = keptAddress(href, location.origin);
        if (address) addresses.set(target.fileId, address);
        else addresses.delete(target.fileId);
      }
      // The click that the script makes is not trusted, so the listener above ignores it, and the
      // browser does what the link says: it follows the link, saves a download, or opens a new tab.
      // A page script that changed the link in the meantime gets no click on the new address.
      const destination = () =>
        [(link as HTMLAnchorElement).href, link.dataset['url'], link.dataset['fileId']].join(' ');
      const checked = destination();
      const followLink = () => {
        if (link.isConnected && destination() === checked) link.click();
      };
      // A reset that comes while the click waits ends it: the click belongs to this moment.
      const taken = generation;
      clicks += 1;
      const click = clicks;
      void (async () => {
        // The click is taken at once, even while the settings and the tabs are still loading.
        await starting;
        // The viewer is off, or this copy has ended by now: the click goes to the link after all.
        if (!enabled || !live) {
          followLink();
          return;
        }
        const result = await openTarget(target, href, taken).catch(() => 'failed' as const);
        // The pane could not take the file, so the student gets the link, and never a dead click.
        // A newer click wins, because the student has moved on from this one.
        if (
          (result === 'failed' || (result === 'ended' && generation !== taken)) &&
          click === clicks
        )
          followLink();
      })().catch(() => undefined);
    },
    { capture: true, signal: lifetime.signal },
  );
  // The settings and the stored tabs load while the listeners above already work.
  const born = generation;
  const starting = (async () => {
    const context = await readContext();
    if (!live) return;
    // The settings say the switch is off, so this copy ends. A read that failed ends nothing.
    if (context?.tools.fileViewer === false) {
      teardown();
      return;
    }
    if (!context?.tools.fileViewer) return;
    themeChoice = context.settings?.theme ?? 'auto';
    width = normalizeWidth(context.tools.fileViewerWidth);
    const stored = await readTabs().catch(() => null);
    if (!live) return;
    // A reset during the read drops the answer: those tabs belong to the earlier student.
    if (stored && born === generation) {
      tabs = stored.tabs;
      tabsToken = stored.token;
    }
    enabled = true;
  })().catch(() => undefined);
  // The background sends three kinds of message to this script. It says when a setting changed, so
  // the pane follows the Theme setting at once, and the script ends when the File viewer switch
  // goes off. It says when it cleared the data of a student, and the pane closes. And it passes on
  // a file that the click catcher took in the frame of the submission details page, whose files
  // list this script cannot see (frame.ts, decision 25, item 11).
  const onBackground = (
    message: unknown,
    sender: Browser.runtime.MessageSender,
    respond: (reply: { opened: boolean }) => void,
  ): boolean | undefined => {
    const request = message as { type?: unknown; fileId?: unknown; address?: unknown } | null;
    if (request?.type === 'weekrow:changed') {
      void readContext().then(
        (latest) => {
          // The File viewer switch went off. The catcher stops at once, so a click follows the
          // link as Canvas drew it, and the pane closes. The background starts a new copy of
          // this script when the switch goes on again.
          if (latest?.tools.fileViewer === false) {
            teardown();
            return;
          }
          const choice = latest?.settings?.theme;
          if (choice && choice !== themeChoice) {
            themeChoice = choice;
            applyTheme();
          }
          // The turn-in pane shares the width, and it may have saved a new one.
          if (latest?.tools.fileViewerWidth !== undefined) {
            width = normalizeWidth(latest.tools.fileViewerWidth);
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
    const taken = generation;
    const address = keptAddress(String(request.address ?? ''), location.origin);
    if (address === undefined) addresses.delete(fileId);
    else addresses.set(fileId, address);
    void (async () => {
      await starting;
      // The catcher saves the file in the usual way unless the pane has it, so the answer comes
      // after the open.
      // The catcher clicks the link again on `false`, and only a failed open wants that.
      const result =
        live && enabled ? await openTarget({ fileId }, `/files/${fileId}`, taken) : null;
      respond({ opened: live && result !== null && result !== 'failed' });
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
  // The weekly dock waits for this report before it first shows, so it never shows on a page that
  // opens with a file pane. The pane is open by now, or none will open.
  try {
    if (live && enabled && tabs.active) await show();
  } finally {
    reportFilePane();
  }
}
