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
type OpenResult = 'opened' | 'closed' | 'ended' | 'failed' | 'timeout';

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
  const active = () => live && !lifetime.signal.aborted;
  let enabled = false;
  const readContext = () =>
    browser.runtime.sendMessage({ type: 'weekrow:page-context' }) as Promise<
      { tools: ToolsSettings; settings?: { theme?: ThemeChoice } } | undefined
    >;
  // `null` when the background did not answer, such as before the first load of the list. The
  // tabs in memory stay as they are then. The token comes with the tabs and goes back with a
  // write, so the background can refuse a write for tabs that it has cleared since.
  type StoredTabs = { tabs: Tabs; token: string | undefined };
  const readTabsNow = async (): Promise<StoredTabs | null> => {
    if (!active()) return null;
    let pendingWrites: Promise<unknown>;
    do {
      pendingWrites = writes;
      await pendingWrites;
    } while (pendingWrites !== writes);
    if (!active()) return null;
    const reply: unknown = await browser.runtime.sendMessage({ type: 'viewer:tabs-get' });
    if (typeof reply !== 'object' || reply === null) return null;
    const token = (reply as { token?: unknown }).token;
    return { tabs: normalizeTabs(reply), token: typeof token === 'string' ? token : undefined };
  };
  let reading: { generation: number; result: Promise<StoredTabs | null> } | undefined;
  const readTabs = () => {
    const current = { generation, result: readTabsNow() };
    reading = current;
    void current.result
      .finally(() => {
        if (reading === current) reading = undefined;
      })
      .catch(() => undefined);
    return current.result;
  };
  let writes: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(run: () => Promise<T>, finishCleanup = false): Promise<T | undefined> => {
    if (!active()) return Promise.resolve(undefined);
    // Accepted cleanup must follow earlier intents even when the document tears down.
    const next = writes.then(() => (active() || finishCleanup ? run() : undefined));
    writes = next.catch(() => undefined);
    return next;
  };
  let unseen = {
    added: new Set<string>(),
    evicted: new Set<string>(),
    token: undefined as string | undefined,
  };
  const flushOpens = () => {
    const ids = [...addedTabs].map((id) => [id, actionTokens.get(id)] as const);
    const effects = unseen;
    const current = attempt;
    const started = generation;
    return enqueue(async () => {
      for (const [fileId, credential] of ids) {
        if (credential === undefined) continue;
        if (!active() || current.result || started !== generation) return;
        const reply = await browser.runtime
          .sendMessage({
            type: 'viewer:tabs-open',
            fileId,
            token: credential,
          })
          .catch(() => undefined);
        if (!reply || typeof reply !== 'object') {
          if (active() && !current.result && started === generation) {
            actionTokens.set(fileId, undefined);
          }
          continue;
        }
        effects.token = credential;
        if (reply.added) effects.added.add(fileId);
        if (
          typeof reply.evicted === 'string' &&
          !effects.added.delete(reply.evicted) &&
          effects.evicted.size < 8
        )
          effects.evicted.add(reply.evicted);
        const kept = normalizeTabs(reply);
        for (const id of effects.added) if (!kept.ids.includes(id)) effects.added.delete(id);
        if (active() && !current.result && started === generation) {
          tabs = normalizeTabs(reply);
          for (const [id] of ids) if (actionTokens.get(id) === undefined) tabs = openFile(tabs, id);
          if (waitingFile) tabs = openFile(tabs, waitingFile);
          tabsToken = credential;
        }
      }
    });
  };
  const undoUnseen = (clear = false) => {
    const effects = unseen;
    const token = tabsToken;
    return enqueue(async () => {
      const credential = effects.token ?? token;
      if (credential === undefined) return;
      const reply = await browser.runtime.sendMessage({
        type: clear ? 'viewer:tabs-clear' : 'viewer:tabs-undo',
        ...(!clear ? { added: [...effects.added], evicted: [...effects.evicted] } : {}),
        token: credential,
      });
      effects.added.clear();
      effects.evicted.clear();
      if (active() && unseen === effects && reply && typeof reply === 'object') {
        tabs = normalizeTabs(reply);
        tabsToken = credential;
      }
    }, true);
  };
  type Attempt = { result?: 'closed' };
  let attempt: Attempt = {};
  let tabs: Tabs = { ids: [], active: null };
  let tabsToken: string | undefined;
  const actionTokens = new Map<string, string | undefined>();
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
  const markSeen = () => {
    if (
      synced &&
      port &&
      dock?.shown &&
      dock.host.isConnected &&
      dock.host.getAttribute('data-identity') === 'yes'
    ) {
      sawTabs = true;
      unseen.added.clear();
      unseen.evicted.clear();
    }
  };
  const sendCovered = () => {
    markSeen();
    port?.postMessage({
      type: 'covered',
      covered:
        dock !== undefined &&
        (!dock.shown || dock.host.getAttribute('data-identity') === 'unknown'),
    });
  };
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
      token: actionTokens.get(fileId),
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
  let sawTabs = false;
  // The file of an open that has not reached the pane yet.
  let waitingFile: string | null = null;
  const addedTabs = new Set<string>();
  const rememberStored = (stored: StoredTabs) => {
    if (tabsToken !== undefined && stored.token !== undefined && tabsToken !== stored.token) {
      addedTabs.clear();
      waitingFile = null;
      synced = false;
      sawTabs = false;
      unseen = { added: new Set(), evicted: new Set(), token: stored.token };
      courses.clear();
      names.clear();
      addresses.clear();
    }
    tabsToken = stored.token;
  };
  type ActionToken = string | undefined | Promise<string | undefined>;
  // An action shares the read running at that moment, and never a later read.
  const captureToken = (): ActionToken => {
    if (tabsToken !== undefined) return tabsToken;
    const born = generation;
    const pending = reading?.generation === born ? reading.result : readTabs();
    return pending
      .then((stored) => {
        if (!active() || born !== generation || !stored) return undefined;
        if (tabsToken === undefined) rememberStored(stored);
        return stored.token;
      })
      .catch(() => undefined);
  };
  let failureAddress = '';
  let failedConnection = false;
  /** The address of a file or a comment attachment in Canvas. */
  const canvasAddress = (id: string, courseId: string | null | undefined = courses.get(id)) => {
    const links = fileLinks(location.origin, id, courseId);
    return links?.canvas ?? links!.download;
  };
  const removeAddedTabs = () => {
    tabs = {
      ids: tabs.ids.filter((id) => !addedTabs.has(id) && !unseen.added.has(id)),
      active: null,
    };
    addedTabs.clear();
    waitingFile = null;
  };
  const connectionFailed = () => {
    if (!active()) return;
    failedConnection = true;
    clearTimeout(handshake);
    removeHello?.();
    removeHello = undefined;
    pending?.close();
    pending = undefined;
    port?.close();
    port = undefined;
    const address = failureAddress || (tabs.active ? canvasAddress(tabs.active) : location.origin);
    removeAddedTabs();
    dock?.showFailure(address);
    settleConnection?.('timeout');
    settleConnection = undefined;
  };
  // Sends the active file to a pane that has not been told yet, and the theme to any pane.
  const send = async () => {
    if (!active()) return;
    const started = generation;
    const current = attempt;
    const sendingDock = dock;
    const sendingPort = port;
    const [latest, stored] = await Promise.all([
      readContext().catch(() => undefined),
      readTabs().catch(() => null),
    ]);
    if (
      !active() ||
      generation !== started ||
      current.result ||
      dock !== sendingDock ||
      port !== sendingPort
    )
      return;
    if (latest?.settings?.theme) themeChoice = latest.settings.theme;
    if (stored) {
      rememberStored(stored);
      const next = [...addedTabs].reduce(openFile, stored.tabs);
      tabs = waitingFile ? openFile(next, waitingFile) : next;
    }
    // The pane has connected, so the files of the clicks that waited for it join the stored tabs,
    // and the pane restores them.
    if (port && addedTabs.size > 0) {
      await flushOpens().catch(() => undefined);
      if (
        !active() ||
        generation !== started ||
        current.result ||
        dock !== sendingDock ||
        port !== sendingPort
      )
        return;
    }
    applyTheme();
    sendFullView();
    sendCovered();
    if (tabs.active && port && !synced) {
      synced = true;
      markSeen();
      waitingFile = null;
      for (const id of addedTabs)
        if (id !== tabs.active && actionTokens.get(id) === undefined)
          port.postMessage(openMessage(id));
      port.postMessage(openMessage(tabs.active));
      addedTabs.clear();
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
    if (result === 'closed') {
      attempt.result = result;
      attempt = {};
    }
    showing = undefined;
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
    if (!active()) return;
    await browser.runtime.sendMessage({
      type: 'weekrow:save-tools',
      tools: { ...latest.tools, fileViewerWidth: width },
    });
  };
  const close = () => {
    if (!active()) return;
    drop('closed');
    void undoUnseen(sawTabs).catch(() => undefined);
  };
  // The background cleared the data of a student: a sign-out, another student or a new address.
  // The pane closes, also a pane that another pane covers, and nothing of the earlier student
  // stays in this page: not the tabs, not the course or the name of a file. The background holds
  // no tabs any more, so nothing is written.
  // An open that started before the reset belongs to the earlier student and ends without a pane,
  // so `generation` counts the resets.
  let generation = 0;
  const wantsLink = (result: OpenResult | null) =>
    result === null || result === 'failed' || result === 'ended';
  const reset = (result: OpenResult = 'ended') => {
    generation += 1;
    showing = undefined;
    drop(result);
    tabs = { ids: [], active: null };
    tabsToken = undefined;
    synced = false;
    sawTabs = false;
    unseen = { added: new Set(), evicted: new Set(), token: undefined };
    courses.clear();
    names.clear();
    addresses.clear();
    actionTokens.clear();
  };
  const stopReset = watchPaneReset(() => reset());
  lifetime.signal.addEventListener('abort', stopReset, { once: true });
  // A page can remove the host. Then no pane is open, and the next click opens a new one.
  const paneOpen = () => {
    if (dock && !dock.host.isConnected) drop();
    return dock !== undefined;
  };
  // Opens the pane. A call while another one is in progress waits for the same open.
  let showing: Promise<void> | undefined;
  const show = (): Promise<void> => {
    if (!active()) return Promise.resolve();
    if (showing === undefined) {
      const run: Promise<void> = showNow(generation, attempt).finally(() => {
        if (showing === run) showing = undefined;
      });
      showing = run;
    }
    return showing;
  };
  const showNow = async (started: number, current: Attempt) => {
    if (!active()) return;
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
    if (!active() || generation !== started || current.result) return;
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
      if (!active()) return;
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
        if (!active()) return;
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
  // Requests reach the pane in click order. The background applies each intent to its current
  // store; callers wait separately for the pane connection.
  let opens: Promise<unknown> = Promise.resolve();
  // The opens that wait or run, and the clicks that the script took. The newest click wins.
  let waitingOpens = 0;
  let clicks = 0;
  // The pane came from an open that has not given it a file yet.
  let emptyPane = false;
  const openTarget = (
    target: FileTarget,
    href: string,
    taken: number,
    current: Attempt,
    actionToken: ActionToken,
  ): Promise<OpenResult> => {
    waitingOpens += 1;
    const run = opens
      .then(() => openNow(target, href, taken, current, actionToken))
      .finally(() => {
        waitingOpens -= 1;
      });
    opens = run.catch(() => undefined);
    // The tab writes stay ordered while each caller waits separately for the frame to connect.
    return run.then((result) => (typeof result === 'string' ? result : result.connected));
  };
  /**
   * Opens a file in the pane: resolves a module item to its file, then adds the tab. It resolves
   * to `opened` when the connected pane can take the file, to `closed` when the student
   * closes the pane, to `ended` when another cause ends it, and to `failed` when the pane could not take the file.
   */
  const openNow = async (
    target: FileTarget,
    href: string,
    started: number,
    current: Attempt,
    actionToken: ActionToken,
  ): Promise<OpenResult | { connected: Promise<OpenResult> }> => {
    const ended = () =>
      current.result ?? (!active() || generation !== started ? 'ended' : undefined);
    if (ended()) return ended()!;
    if (failedConnection) drop();
    // Callers have checked this target against the Canvas origin.
    failureAddress = keptAddress(href, location.origin) ?? new URL(href, location.origin).href;
    if (paneOpen()) {
      // A turn-in may have covered the pane. A file shows the pane again.
      dock?.setHidden(false);
    } else {
      await show();
      if (ended()) return ended()!;
      emptyPane = true;
    }
    if (ended()) return ended()!;
    if (!paneOpen()) return 'failed';
    const connected = connection;
    const file =
      'fileId' in target
        ? target
        : ((await browser.runtime
            .sendMessage({ type: 'viewer:module-item', ...target })
            .catch(() => undefined)) as { fileId: string } | undefined);
    if (ended()) return ended()!;
    if (failedConnection) return connected ? { connected } : 'timeout';
    if (!paneOpen()) return connected ? { connected } : 'failed';
    if (!file) {
      // A pane that only this kind of open made has no file to show, and no open behind it will
      // give it one. A pane that shows a file stays.
      if (emptyPane && !synced && waitingOpens === 1) drop();
      return 'failed';
    }
    emptyPane = false;
    const credential = await actionToken;
    if (ended()) return ended()!;
    if (!paneOpen()) return 'ended';
    actionTokens.set(file.fileId, credential);
    const courseId = 'courseId' in target ? target.courseId : courseOfLink(href, location.origin);
    if (courseId) courses.set(file.fileId, courseId);
    failureAddress =
      addresses.get(file.fileId) ??
      keptAddress(href, location.origin) ??
      canvasAddress(file.fileId, courseId);
    const open = async () => {
      // The pane owns synced opens and orders their writes with its other tab actions.
      if (!synced && addedTabs.size > 0) {
        await flushOpens().catch(() => undefined);
        if (ended()) return ended()!;
        if (!paneOpen() || (!port && !connection)) {
          removeAddedTabs();
          await undoUnseen().catch(() => undefined);
          return ended() ?? 'ended';
        }
        if (!port) return { connected: connection! };
      }
      synced = true;
      markSeen();
      waitingFile = null;
      for (const id of addedTabs)
        if (id !== file.fileId && actionTokens.get(id) === undefined)
          port?.postMessage(openMessage(id));
      port?.postMessage(openMessage(file.fileId));
      addedTabs.clear();
      return 'opened' as const;
    };
    // A pane that has been told owns the tabs. A pane that has not been told gets this file with
    // the files that wait for it, below.
    if (paneOpen() && port && synced) return open();
    const stored = await readTabs().catch(() => null);
    if (ended()) return ended()!;
    if (failedConnection) return connected ? { connected } : 'timeout';
    if (stored) {
      rememberStored(stored);
    }
    const previous = [...addedTabs].reduce(openFile, stored?.tabs ?? tabs);
    if (!previous.ids.includes(file.fileId)) {
      addedTabs.add(file.fileId);
    }
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
      const current = attempt;
      const actionToken = captureToken();
      clicks += 1;
      const click = clicks;
      void (async () => {
        // The click is taken at once, even while the settings and the tabs are still loading.
        await waitStarting();
        // The viewer is off, or this copy has ended by now: the click goes to the link after all.
        if (!enabled || !active()) {
          followLink();
          return;
        }
        const result = await openTarget(target, href, taken, current, actionToken).catch(
          () => 'failed' as const,
        );
        // The pane could not take the file, so the student gets the link, and never a dead click.
        // A newer click wins, because the student has moved on from this one.
        if (wantsLink(result) && click === clicks) followLink();
      })().catch(() => undefined);
    },
    { capture: true, signal: lifetime.signal },
  );
  // The settings and the stored tabs load while the listeners above already work.
  // A newer load replaces an older one. A reset alone does not: it only drops the tabs it read.
  let loads = 0;
  const load = async () => {
    if (!active()) return;
    const mine = ++loads;
    const born = generation;
    const context = await readContext();
    if (!active() || mine !== loads) return;
    // The settings say the switch is off, so this copy ends. A read that failed ends nothing.
    if (context?.tools.fileViewer === false) {
      teardown();
      return;
    }
    if (!context?.tools.fileViewer) return;
    themeChoice = context.settings?.theme ?? 'auto';
    width = normalizeWidth(context.tools.fileViewerWidth);
    const stored = await readTabs().catch(() => null);
    if (!active() || mine !== loads) return;
    // A reset during the read drops the answer: those tabs belong to the earlier student.
    if (stored && born === generation) {
      tabs = stored.tabs;
      rememberStored(stored);
    }
    enabled = true;
  };
  let starting = load().catch(() => undefined);
  const waitStarting = async () => {
    let current: Promise<void>;
    do {
      current = starting;
      await current;
    } while (active() && current !== starting);
  };
  addEventListener(
    'pageshow',
    (event) => {
      if (!active() || !(event as PageTransitionEvent).persisted) return;
      reset('closed');
      const restored = generation;
      starting = load().catch(() => undefined);
      void starting
        .then(async () => {
          if (active() && generation === restored && enabled && tabs.active) await show();
        })
        .finally(reportFilePane);
    },
    { signal: lifetime.signal },
  );
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
          if (!active()) return;
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
    const current = attempt;
    const actionToken = captureToken();
    const address = keptAddress(String(request.address ?? ''), location.origin);
    if (address === undefined) addresses.delete(fileId);
    else addresses.set(fileId, address);
    void (async () => {
      await waitStarting();
      // The catcher saves the file in the usual way unless the pane has it, so the answer comes
      // after the open.
      // Both channels give the student the link when the pane did not handle the open.
      const result =
        active() && enabled
          ? await openTarget({ fileId }, `/files/${fileId}`, taken, current, actionToken)
          : null;
      respond({ opened: !wantsLink(result) });
    })().catch(() => respond({ opened: false }));
    return true;
  };
  browser.runtime.onMessage.addListener(onBackground);
  lifetime.signal.addEventListener(
    'abort',
    () => browser.runtime.onMessage.removeListener(onBackground),
    { once: true },
  );
  await waitStarting();
  if (active() && !enabled) {
    // A click that came before the settings loaded keeps the link action.
    lifetime.abort();
  }
  if (active() && enabled && isSubmissionPage(location.pathname)) {
    // Every load of the frame is a new document, which needs its own catcher. A script of the
    // page can fire a load event, so only a trusted one counts.
    // One ask at a time, and one more after it when a load came meanwhile. A page that loads its
    // frame again and again cannot make the background probe the tab more often than it can answer.
    let asking = false;
    let askAgain = false;
    const askForCatcher = () => {
      if (!active()) return;
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
          if (askAgain && active()) {
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
    if (active() && enabled && tabs.active) await show();
  } finally {
    reportFilePane();
  }
}
