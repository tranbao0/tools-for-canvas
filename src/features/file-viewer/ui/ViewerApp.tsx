/**
 * The content of the file pane (design decision 25): the tabs of the open files, the card of the
 * active file, and the region where the viewers draw the file.
 *
 * The background keeps the tabs of the browser tab. This app reads them when the page asks it to
 * open a file, and writes them back after every change the student makes in the pane.
 */
import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { CloseIcon } from '../../../shared/ui/icons';
import { t } from '../../../shared/ui/i18n';
import { closeFile, openFile, type Tabs, type TabIntent } from '../model';
import { FileCard, type FileState, type PaneFile } from './FileCard';
import type { CoveredHost } from './covered';
import type { FullViewHost } from './fullView';
import { FullViewButton } from './FullViewButton';
import { canShow, fileKind, isPdf } from './fileInfo';
import { fileLinks, readAddress } from './links';
import { PdfTab, type PdfHost } from './PdfTab';
import { MediaTab } from './MediaTab';
import { PANEL_ID, TabStrip, tabDomId, type TabItem } from './TabStrip';

/** What the pane needs from the extension and from the Canvas page. */
export interface PaneHost extends PdfHost {
  /** The saved Canvas address. */
  origin: string;
  /**
   * The record of a file, or `undefined` when it did not load. The `fileId` is a tab id, and the
   * name is the text of the link that opened a comment attachment, when the page gave one.
   */
  loadFile(fileId: string, name?: string): Promise<PaneFile | undefined>;
  /** Whether the browser lets the extension reach the files of the saved Canvas. */
  hasAccess(): Promise<boolean>;
  /** Asks the browser for that access. Call it directly inside a click handler. */
  requestAccess(): Promise<boolean>;
  getTabs(): Promise<Tabs>;
  /** Capture this token inside the student action, before any await. */
  tabToken(): string | undefined;
  changeTabs(intent: TabIntent, token: string): Promise<Tabs>;
  /** Asks the Canvas page to close the pane. */
  closePane(): void;
  /** The full view state of the pane, which the Canvas page keeps. */
  fullView: FullViewHost;
  /** Whether another pane covers this one. The Canvas page keeps that too. */
  covered: CoveredHost;
}

/** The Canvas page asks the pane to open a file. */
export interface OpenRequest {
  fileId: string;
  /** The token at the page click; an absent token never permits a store write. */
  token?: string;
  courseId?: string;
  name?: string;
  /**
   * The address of the clicked link when it carried a `verifier` or a `location`. The error card
   * links to it. The pane keeps it in memory only and never reads it.
   */
  address?: string;
}

export interface OpenSource {
  subscribe(listener: (request: OpenRequest) => void): () => void;
}

const EMPTY: Tabs = { ids: [], active: null };

export function ViewerApp(props: { host: PaneHost; opens: OpenSource }) {
  const { host } = props;
  const [tabs, setTabs] = useState<Tabs>(EMPTY);
  const [files, setFiles] = useState<Readonly<Record<string, FileState>>>({});
  const [access, setAccess] = useState(true);
  const tabsRef = useRef<Tabs>(EMPTY);
  const requested = useRef(new Set<string>());
  const loads = useRef(new Map<string, symbol>());
  const courseHints = useRef(new Map<string, string>());
  const nameHints = useRef(new Map<string, string>());
  const addresses = useRef(new Map<string, string>());
  const focusAfter = useRef<string | null>(null);
  // While another pane covers this one, no tab is the active tab: media pauses and PDFs save
  // their place, as for a tab that another tab hides.
  const [covered, setCovered] = useState(host.covered.get());
  useEffect(() => {
    setCovered(host.covered.get());
    return host.covered.subscribe(setCovered);
  }, [host]);

  // Counts the reads of each PDF. A change makes the tab read its file again.
  const [attempts, setAttempts] = useState<Readonly<Record<string, number>>>({});
  const failedReads = useRef(new Set<string>());
  const readAgain = useCallback((fileId: string) => {
    failedReads.current.delete(fileId);
    setAttempts((all) => ({ ...all, [fileId]: (all[fileId] ?? 0) + 1 }));
  }, []);

  const accessCalls = useRef(0);
  const refreshAccess = useCallback(() => {
    // Only the newest answer counts, so a slow older answer cannot undo a newer one.
    accessCalls.current += 1;
    const call = accessCalls.current;
    host.hasAccess().then(
      (granted) => {
        if (call === accessCalls.current) setAccess(granted);
      },
      () => undefined,
    );
  }, [host]);

  // The pane owns the tabs once they are loaded. The writes go out in order.
  const loaded = useRef(false);
  const pending = useRef<Promise<unknown>>(Promise.resolve());
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const memory = useRef(new Set<string>());
  const changes = useRef(0);
  // Failed writes belong to this mounted pane, just like tokenless opens.
  const localTabs = useRef(new Map<string, boolean>());
  const selection = useRef(0);
  const failedSelection = useRef<number | undefined>(undefined);
  // The change that last touched each file. A write that finishes sets the local state of a file
  // only when no later change, with or without a write, touched that file.
  const lastChange = useRef(new Map<string, number>());
  const reading = useRef<Promise<{ tabs: Tabs; token: string | undefined }> | undefined>(undefined);
  const readTabs = useCallback(() => {
    if (reading.current) return reading.current;
    const result = host.getTabs().then((tabs) => ({ tabs, token: host.tabToken() }));
    reading.current = result;
    void result
      .finally(() => {
        if (reading.current === result) reading.current = undefined;
      })
      .catch(() => undefined);
    return result;
  }, [host]);
  const save = useCallback(
    (
      intent: TabIntent,
      credential: string | undefined | Promise<string | undefined>,
      before: Tabs,
    ) => {
      const after = tabsRef.current;
      // Include evictions as well as the file named by the intent.
      const touched = new Set(
        [...before.ids, ...after.ids].filter(
          (id) => before.ids.includes(id) !== after.ids.includes(id),
        ),
      );
      if ('fileId' in intent && intent.action !== 'activate') touched.add(intent.fileId);
      const selects =
        before.active !== after.active || intent.action === 'open' || intent.action === 'activate';
      const selectedAt = selects ? ++selection.current : selection.current;
      const change = ++changes.current;
      for (const id of touched) lastChange.current.set(id, change);
      if (credential === undefined) return;
      writes.current = writes.current
        .then(async () => {
          const token = await credential;
          if (token === undefined) return;
          let latest: Tabs;
          const own = () => [...touched].filter((id) => lastChange.current.get(id) === change);
          try {
            latest = await host.changeTabs(intent, token);
            for (const id of own()) {
              localTabs.current.delete(id);
              memory.current.delete(id);
            }
            if (selects && failedSelection.current === selectedAt)
              failedSelection.current = undefined;
          } catch {
            for (const id of own()) {
              const present = after.ids.includes(id);
              localTabs.current.set(id, present);
              if (present) memory.current.add(id);
              else memory.current.delete(id);
            }
            if (selects) failedSelection.current = selectedAt;
            return;
          }
          if (change !== changes.current) return;
          const local = tabsRef.current;
          for (const [id, present] of localTabs.current) {
            if (!present) latest = closeFile(latest, id);
          }
          const kept = latest.active;
          const selected =
            failedSelection.current === selection.current ||
            (local.active && memory.current.has(local.active))
              ? local.active
              : latest.active;
          for (const [index, id] of local.ids.entries()) {
            if (!memory.current.has(id)) continue;
            latest = openFile({ ids: latest.ids, active: selected }, id);
            const ids = latest.ids.filter((entry) => entry !== id);
            ids.splice(Math.min(index, ids.length), 0, id);
            latest = { ids, active: selected };
          }
          // The tab that the student chose may be gone by now, for example after a later close.
          const valid = (id: string | null) => id !== null && latest.ids.includes(id);
          latest = {
            ...latest,
            active: valid(selected) ? selected : valid(kept) ? kept : (latest.ids[0] ?? null),
          };
          tabsRef.current = latest;
          setTabs(latest);
        })
        .catch(() => undefined);
    },
    [host],
  );
  const commit = useCallback(
    (next: Tabs, intent: TabIntent) => {
      const before = tabsRef.current;
      tabsRef.current = next;
      setTabs(next);
      if (intent.action === 'close') memory.current.delete(intent.fileId);
      const token =
        host.tabToken() ??
        readTabs().then(
          (reply) => reply.token,
          () => undefined,
        );
      save(intent, token, before);
    },
    [host, readTabs, save],
  );

  const load = useCallback(
    (fileId: string) => {
      const call = Symbol();
      loads.current.set(fileId, call);
      setFiles((all) => ({ ...all, [fileId]: { kind: 'loading' } }));
      // A pane without a token, because its first read of the tabs was refused, asks again before
      // the file loads: a comment attachment reads its bytes only with a token. A read that
      // fails again changes nothing, and the file loads as before.
      (loaded.current
        ? Promise.resolve()
        : readTabs().then(
            () => undefined,
            () => undefined,
          )
      )
        .then(() => host.loadFile(fileId, nameHints.current.get(fileId)))
        .then(
          (file): FileState => (file ? { kind: 'ready', file } : { kind: 'error' }),
          (): FileState => ({ kind: 'error' }),
        )
        .then((state) => {
          if (loads.current.get(fileId) !== call || !tabsRef.current.ids.includes(fileId)) return;
          setFiles((all) => ({ ...all, [fileId]: state }));
          refreshAccess();
          if (state.kind === 'ready' && !loaded.current) {
            void readTabs().then(
              () => {
                loaded.current = true;
              },
              () => undefined,
            );
          }
        });
    },
    [host, readTabs, refreshAccess],
  );

  useEffect(refreshAccess, [refreshAccess]);

  useEffect(
    () =>
      props.opens.subscribe((request) => {
        if (request.courseId) courseHints.current.set(request.fileId, request.courseId);
        if (request.name) nameHints.current.set(request.fileId, request.name);
        // The page decides: a click on a link without the parameters drops an older address.
        if (request.address) addresses.current.set(request.fileId, request.address);
        else addresses.current.delete(request.fileId);
        // A page request keeps its own read result, even when this pane reads again.
        const token = request.token;
        // The requests run one after another, so the first read of the stored tabs finishes
        // before the next request adds to the tabs.
        pending.current = pending.current
          .then(async () => {
            // The first request restores the tabs that the background keeps. Later ones add to the
            // tabs in memory, which already hold every change of the student. A read that fails
            // is not "no tabs": the next request reads again, and tabs that opened meanwhile stay.
            let known = tabsRef.current;
            if (!loaded.current) {
              try {
                const { tabs: stored } = await readTabs();
                loaded.current = true;
                if (known.ids.length === 0) known = stored;
              } catch {
                // The tabs in memory stay, and they are not written.
              }
            }
            if (token === undefined && !known.ids.includes(request.fileId))
              memory.current.add(request.fileId);
            else if (token !== undefined) memory.current.delete(request.fileId);
            const next = openFile(known, request.fileId);
            tabsRef.current = next;
            setTabs(next);
            save({ action: 'open', fileId: request.fileId }, token, known);
          })
          .catch(() => undefined);
      }),
    [host, props.opens, readTabs, save],
  );

  useEffect(() => {
    const ids = new Set(tabs.ids);
    const removed = [...requested.current].filter((id) => !ids.has(id));
    for (const fileId of removed) {
      requested.current.delete(fileId);
      failedReads.current.delete(fileId);
      loads.current.delete(fileId);
    }
    if (removed.length > 0) {
      setFiles((all) => Object.fromEntries(Object.entries(all).filter(([id]) => ids.has(id))));
      setAttempts((all) => Object.fromEntries(Object.entries(all).filter(([id]) => ids.has(id))));
    }
    for (const fileId of tabs.ids) {
      if (requested.current.has(fileId)) continue;
      requested.current.add(fileId);
      load(fileId);
    }
  }, [tabs.ids, load]);

  useEffect(() => {
    if (focusAfter.current === null) return;
    document.getElementById(tabDomId(focusAfter.current))?.focus();
    focusAfter.current = null;
  }, [tabs]);

  const activate = (fileId: string) => {
    if (tabsRef.current.active !== fileId)
      commit({ ids: tabsRef.current.ids, active: fileId }, { action: 'activate', fileId });
  };
  const close = (fileId: string) => {
    const wasActive = tabsRef.current.active === fileId;
    const next = closeFile(tabsRef.current, fileId);
    commit(next, { action: 'close', fileId });
    if (next.ids.length === 0) {
      host.closePane();
      return;
    }
    if (wasActive) focusAfter.current = next.active;
  };
  const reload = (fileId: string) => {
    if (!tabsRef.current.ids.includes(fileId)) return;
    requested.current.add(fileId);
    failedReads.current.delete(fileId);
    load(fileId);
  };
  const allow = () => {
    // The request must start inside the click, so nothing comes before it.
    host.requestAccess().then(
      () => {
        refreshAccess();
        const retry = new Set<string>(tabs.active === null ? [] : [tabs.active]);
        for (const [fileId, state] of Object.entries(files)) {
          if (state.kind === 'error') retry.add(fileId);
        }
        // A card that loads again also reads its PDF again, because the tab draws after the
        // record is ready. Another PDF whose bytes did not load reads them again.
        const again = [...failedReads.current].filter((fileId) => !retry.has(fileId));
        retry.forEach(reload);
        again.forEach(readAgain);
      },
      () => undefined,
    );
  };

  const items: Record<string, TabItem | undefined> = {};
  for (const fileId of tabs.ids) {
    const state = files[fileId];
    if (state?.kind === 'ready') {
      items[fileId] = {
        name: state.file.name,
        kind: fileKind(state.file.contentType, state.file.name),
      };
    } else if (state?.kind === 'error') {
      items[fileId] = { name: t('fileTabUnavailable'), kind: 'document' };
    }
  }
  const active = tabs.active;
  // Each PDF tab keeps its own document while the pane is open. The tabs of other files draw nothing.
  const pdfTabs: ComponentChildren[] = [];
  for (const fileId of tabs.ids) {
    const state = files[fileId];
    if (state?.kind !== 'ready') continue;
    if (!canShow(state.file.contentType, state.file.name, state.file.size)) continue;
    const course = courseHints.current.get(fileId) ?? state.file.courseId;
    const links = fileLinks(host.origin, fileId, course);
    if (!links) continue;
    const readFrom = readAddress(host.origin, fileId, state.file.url) ?? links.download;
    if (!isPdf(state.file.contentType)) {
      pdfTabs.push(
        <MediaTab
          key={fileId}
          host={host}
          url={readFrom}
          name={state.file.name}
          contentType={state.file.contentType}
          active={!covered && fileId === active}
          attempt={attempts[fileId] ?? 0}
          onRetry={() => readAgain(fileId)}
          onReadFailed={() => {
            failedReads.current.add(fileId);
            refreshAccess();
          }}
        />,
      );
      continue;
    }
    pdfTabs.push(
      <PdfTab
        fileId={fileId}
        key={fileId}
        url={readFrom}
        file={state.file}
        links={links}
        access={access}
        onAllow={allow}
        host={host}
        active={!covered && fileId === active}
        attempt={attempts[fileId] ?? 0}
        onReadFailed={() => {
          failedReads.current.add(fileId);
          refreshAccess();
        }}
        onRetry={() => readAgain(fileId)}
      />,
    );
  }
  const activeState = active === null ? undefined : files[active];
  const activePdf =
    activeState?.kind === 'ready' &&
    canShow(activeState.file.contentType, activeState.file.name, activeState.file.size) &&
    isPdf(activeState.file.contentType);
  const activeLinks =
    active !== null && activeState?.kind === 'ready'
      ? fileLinks(host.origin, active, courseHints.current.get(active) ?? activeState.file.courseId)
      : null;
  return (
    <div class="fv-app">
      <div class="fv-tab-row">
        <TabStrip tabs={tabs} items={items} onActivate={activate} onClose={close} />
        <FullViewButton host={host.fullView} />
        <button
          type="button"
          class="wr-icon-btn fv-pane-close"
          aria-label={t('fileViewerClose')}
          title={t('fileViewerClose')}
          onClick={() => host.closePane()}
        >
          <CloseIcon />
        </button>
      </div>
      <div
        class="fv-panel"
        id={PANEL_ID}
        role={active === null ? undefined : 'tabpanel'}
        aria-labelledby={active === null ? undefined : tabDomId(active)}
      >
        {/* A PDF has its own slim line and toolbar. Every other state keeps the card. */}
        {!(activePdf && activeLinks) && (
          <FileCard
            key={active ?? 'none'}
            fileId={active ?? ''}
            state={(active !== null && files[active]) || { kind: 'loading' }}
            origin={host.origin}
            courseHint={active === null ? undefined : courseHints.current.get(active)}
            address={active === null ? undefined : addresses.current.get(active)}
            access={access}
            onRetry={() => active !== null && reload(active)}
            onAllow={allow}
          />
        )}
        <div class="fv-body" data-part="viewer-body" data-kind={activePdf ? 'pdf' : undefined}>
          {pdfTabs}
        </div>
      </div>
    </div>
  );
}
