/**
 * The content of the file pane (design decision 25): the tabs of the open files, the card of the
 * active file, and the region where the viewers draw the file.
 *
 * The background keeps the tabs of the browser tab. This app reads them when the page asks it to
 * open a file, and writes them back after every change the student makes in the pane.
 */
import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { MAX_FILE_BYTES } from '../../../shared/canvas/fileBytes';
import { t } from '../../../shared/ui/i18n';
import { closeFile, openFile, type Tabs } from '../model';
import { FileCard, type FileState, type PaneFile } from './FileCard';
import { fileKind, isPdf } from './fileInfo';
import { fileLinks } from './links';
import { PdfTab, type PdfHost } from './PdfTab';
import { PANEL_ID, TabStrip, tabDomId, type TabItem } from './TabStrip';

/** What the pane needs from the extension and from the Canvas page. */
export interface PaneHost extends PdfHost {
  /** The saved Canvas address. */
  origin: string;
  /** The record of a file, or `undefined` when it did not load. */
  loadFile(fileId: string): Promise<PaneFile | undefined>;
  /** Whether the browser lets the extension reach the files of the saved Canvas. */
  hasAccess(): Promise<boolean>;
  /** Asks the browser for that access. Call it directly inside a click handler. */
  requestAccess(): Promise<boolean>;
  getTabs(): Promise<Tabs>;
  setTabs(tabs: Tabs): Promise<void>;
  /** Asks the Canvas page to close the pane. */
  closePane(): void;
}

/** The Canvas page asks the pane to open a file. */
export interface OpenRequest {
  fileId: string;
  courseId?: string;
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
  const courseHints = useRef(new Map<string, string>());
  const focusAfter = useRef<string | null>(null);

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

  const load = useCallback(
    (fileId: string) => {
      setFiles((all) => ({ ...all, [fileId]: { kind: 'loading' } }));
      host
        .loadFile(fileId)
        .then(
          (file): FileState => (file ? { kind: 'ready', file } : { kind: 'error' }),
          (): FileState => ({ kind: 'error' }),
        )
        .then((state) => {
          setFiles((all) => ({ ...all, [fileId]: state }));
          refreshAccess();
        });
    },
    [host, refreshAccess],
  );

  // The pane owns the tabs once they are loaded. The writes go out in order.
  const loaded = useRef(false);
  const pending = useRef<Promise<unknown>>(Promise.resolve());
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const save = useCallback(
    (next: Tabs) => {
      writes.current = writes.current.then(() => host.setTabs(next)).catch(() => undefined);
    },
    [host],
  );
  const commit = useCallback(
    (next: Tabs) => {
      tabsRef.current = next;
      setTabs(next);
      save(next);
    },
    [save],
  );

  useEffect(refreshAccess, [refreshAccess]);

  useEffect(
    () =>
      props.opens.subscribe((request) => {
        if (request.courseId) courseHints.current.set(request.fileId, request.courseId);
        // The requests run one after another, so the first read of the stored tabs finishes
        // before the next request adds to the tabs.
        pending.current = pending.current
          .then(async () => {
            // The first request restores the tabs that the background keeps. Later ones add to the
            // tabs in memory, which already hold every change of the student.
            const known = loaded.current
              ? tabsRef.current
              : await host.getTabs().catch(() => tabsRef.current);
            loaded.current = true;
            const next = openFile(known, request.fileId);
            tabsRef.current = next;
            setTabs(next);
            if (JSON.stringify(next) !== JSON.stringify(known)) save(next);
          })
          .catch(() => undefined);
      }),
    [host, props.opens, save],
  );

  useEffect(() => {
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
    if (tabsRef.current.active !== fileId) commit({ ids: tabsRef.current.ids, active: fileId });
  };
  const close = (fileId: string) => {
    const wasActive = tabsRef.current.active === fileId;
    const next = closeFile(tabsRef.current, fileId);
    // A file that opens again loads again, also after an error.
    requested.current.delete(fileId);
    failedReads.current.delete(fileId);
    setFiles((all) => Object.fromEntries(Object.entries(all).filter(([id]) => id !== fileId)));
    commit(next);
    if (next.ids.length === 0) {
      host.closePane();
      return;
    }
    if (wasActive) focusAfter.current = next.active;
  };
  const reload = (fileId: string) => {
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
    if (state?.kind !== 'ready' || !isPdf(state.file.contentType)) continue;
    if (Number.isFinite(state.file.size) && state.file.size > MAX_FILE_BYTES) continue;
    const course = courseHints.current.get(fileId) ?? state.file.courseId;
    const url = fileLinks(host.origin, fileId, course, state.file.url)?.download;
    if (!url) continue;
    pdfTabs.push(
      <PdfTab
        key={fileId}
        url={url}
        host={host}
        active={fileId === active}
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
    isPdf(activeState.file.contentType) &&
    !(Number.isFinite(activeState.file.size) && activeState.file.size > MAX_FILE_BYTES);
  return (
    <div class="fv-app">
      {tabs.ids.length > 0 && (
        <TabStrip tabs={tabs} items={items} onActivate={activate} onClose={close} />
      )}
      <div
        class="fv-panel"
        id={PANEL_ID}
        role={active === null ? undefined : 'tabpanel'}
        aria-labelledby={active === null ? undefined : tabDomId(active)}
      >
        <FileCard
          key={active ?? 'none'}
          fileId={active ?? ''}
          state={(active !== null && files[active]) || { kind: 'loading' }}
          origin={host.origin}
          courseHint={active === null ? undefined : courseHints.current.get(active)}
          access={access}
          onRetry={() => active !== null && reload(active)}
          onAllow={allow}
        />
        <div class="fv-body" data-part="viewer-body" data-kind={activePdf ? 'pdf' : undefined}>
          {pdfTabs}
        </div>
      </div>
    </div>
  );
}
