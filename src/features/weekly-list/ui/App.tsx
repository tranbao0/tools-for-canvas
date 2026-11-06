/**
 * The list surface for the side panel and the Canvas page. It renders props and calls actions.
 * The gear opens the settings in place (design decision 18); Back returns to the view and to
 * the control that opened them.
 */
import type { ComponentChildren, RefObject } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { t, tp } from '../../../shared/ui/i18n';
import {
  DEFAULT_SETTINGS,
  DEFAULT_SPAN,
  type ItemView,
  type Settings,
  type Span,
  type SurfaceState,
} from '../model/types';
import type { Actions, AppProps, SurfaceKind, TaskInput } from './contract';
import { Header } from './Header';
import { RowSizeContext } from './slotMode';
import {
  Dock,
  filterText,
  isUndoShortcut,
  joinNames,
  noteText,
  NoticeLine,
  NoticeQueue,
  OfferBanner,
  staleText,
  type OneTimeNote,
} from './Notices';
import { Bar, newId, newIds, type HeadingLevel } from '../../../shared/ui/parts';
import type { ListTab } from '../data/announcements';
import { Announcements } from './Announcements';
import { ListTabs, tabId } from './ListTabs';
import { ChevronDownIcon } from '../../../shared/ui/icons';
import { usePull } from '../../../shared/ui/pull';
import { Rings } from './Rings';
import { SettingsPanel } from './Settings';
import { Spinner, StateBody } from './States';
import { TaskForm, type TaskFormMode } from './TaskForm';
import {
  groupCount,
  GroupView,
  type BottomKind,
  ViewSwitch,
  WeekList,
  type ListHandlers,
  type OpenMemory,
  OpenMemoryContext,
} from './WeekList';
import { captureFocus, firstRowControl, restoreFocus, usable, type FocusSnapshot } from './focus';

type ReadyState = Extract<SurfaceState, { kind: 'ready' }>;

/** How long focus follows a minimize or an expand that the student asked for. */
const FOCUS_FOLLOW_MS = 1500;

/** Where the groups of the in-page list were scrolled to, kept while the list is on the page. */
interface ScrollMemory {
  top: number;
  /** The span that the position belongs to. Another span starts at the top. */
  key: string;
}

/**
 * The groups of the in-page list, in the one element that scrolls inside the fixed card. The
 * header and the rings stay above it. The element is a region that a keyboard reaches and scrolls.
 */
function ScrollRegion(props: {
  memory: ScrollMemory;
  resetKey: string;
  label: string;
  /** The region keeps its position while it is hidden, and shows it again when it returns. */
  hidden?: boolean;
  children: ComponentChildren;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { memory } = props;
  // A hidden region puts its rows back at once.
  usePull(ref, undefined, false, props.hidden !== true);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null || props.hidden === true) return;
    if (memory.key !== props.resetKey) {
      memory.key = props.resetKey;
      memory.top = 0;
    }
    if (element.scrollTop !== memory.top) element.scrollTop = memory.top;
  }, [memory, props.resetKey, props.hidden]);
  return (
    <div
      ref={ref}
      class="wr-scroll"
      hidden={props.hidden}
      role="region"
      tabIndex={0}
      aria-label={props.label}
      onScroll={(event) => {
        if (!event.currentTarget.hidden) memory.top = event.currentTarget.scrollTop;
      }}
    >
      {props.children}
    </div>
  );
}

/**
 * The list area that shows the open bottom group in place of the day list. The element stays in
 * the card and is hidden while no group is open. A group starts at the top, also for another
 * span, and the same group in the same span gets its position back after the settings or the
 * task form replaced the list.
 */
function GroupArea(props: {
  kind: string | null;
  memory: ScrollMemory;
  resetKey: string;
  children: ComponentChildren;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { memory } = props;
  usePull(ref, undefined, false, props.kind !== null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const key = props.kind === null ? '' : `${props.kind}:${props.resetKey}`;
    if (memory.key !== key) {
      memory.key = key;
      memory.top = 0;
    }
    if (props.kind !== null && element.scrollTop !== memory.top) element.scrollTop = memory.top;
  }, [memory, props.kind, props.resetKey]);
  return (
    <div
      ref={ref}
      class="wr-group-area"
      hidden={props.kind === null}
      onScroll={(event) => {
        if (!event.currentTarget.hidden) memory.top = event.currentTarget.scrollTop;
      }}
    >
      {props.children}
    </div>
  );
}

/** The counts that the minimized bar shows: "3 due today · 11 past due", with no zero part. */
function barStatus(state: SurfaceState): string {
  if (state.kind !== 'ready') return '';
  const count = (kind: string) => {
    const group = state.view.groups.find((g) => g.kind === kind);
    return group ? groupCount(group) : 0;
  };
  const parts: string[] = [];
  if (count('today') > 0) parts.push(tp('dueTodayCount', count('today')));
  if (count('past_due') > 0) parts.push(tp('pastDueCount', count('past_due')));
  return parts.join(' \u00b7 ');
}

/** The slim bar that the minimized in-page list shows. A click anywhere on it expands the list. */
function MinimizedBar(props: { status: string; onExpand(): void }) {
  return (
    <button
      type="button"
      class="wr-minbar"
      data-part="expand"
      aria-expanded="false"
      onClick={props.onExpand}
    >
      <span class="wr-minbar-title">{t('listTitle')}</span>
      {props.status !== '' && <span class="wr-minbar-status">{props.status}</span>}
      <span class="wr-sr">{t('expandList')}</span>
      <ChevronDownIcon />
    </button>
  );
}

/** The panel is its own page, so its top heading is level 1. In a Canvas page it is level 2. */
function baseLevel(surface: SurfaceKind): HeadingLevel {
  return surface === 'panel' ? 1 : 2;
}

function subLevel(level: HeadingLevel): HeadingLevel {
  return level === 1 ? 2 : level === 2 ? 3 : 4;
}

/** Opens the settings in place. `opener` names the control that focus returns to (`data-opener`). */
type OpenSettings = (opener: string) => void;

export function App(props: AppProps) {
  const { surface, state, actions } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const [settingsFrom, setSettingsFrom] = useState<string | null>(null);
  /** The scroll position of the groups, which a redraw, a refresh or the settings keep. */
  const scrollMemory = useRef<ScrollMemory>({ top: 0, key: '' });
  /** The groups and "N older" lines that the student opened, which the views in between keep. */
  const openMemory = useRef<OpenMemory>(new Map());
  /** The scroll position of the Announcements tab. Each tab keeps its own (decision 24). */
  const announcementsScroll = useRef<ScrollMemory>({ top: 0, key: '' });
  /** The scroll position of the open bottom group, which takes the place of the day list. */
  const groupScroll = useRef<ScrollMemory>({ top: 0, key: '' });
  const saved = props.settings?.value;
  const rowSize = saved?.rowSize ?? DEFAULT_SETTINGS.rowSize;
  const minimized = surface === 'inpage' && saved?.minimized === true;
  /**
   * The state that the student asked for, and until when focus follows it. The page can draw the
   * list again after the change, for example when a refresh arrives, and that draw can drop the
   * focus, so the follow lasts a moment and acts only while nothing in the list has focus.
   */
  const pendingFocus = useRef<{ value: boolean; until: number } | null>(null);
  const setMinimized = (value: boolean) => {
    pendingFocus.current = { value, until: Date.now() + FOCUS_FOLLOW_MS };
    if (saved) actions.saveSettings({ ...saved, minimized: value });
  };
  const onMinimize = surface === 'inpage' && saved ? () => setMinimized(true) : undefined;
  /**
   * Focus follows the student's change: the bar takes it on a minimize, and the minimize button on
   * an expand. A change that comes from another tab, or from the saved settings at the start,
   * leaves focus alone.
   */
  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    const root = rootRef.current;
    if (pending === null || root === null) return;
    if (Date.now() > pending.until) {
      pendingFocus.current = null;
      return;
    }
    if (pending.value !== minimized) return;
    const owner = root.getRootNode() as Document | ShadowRoot;
    if (owner.activeElement !== null && root.contains(owner.activeElement)) return;
    root
      .querySelector<HTMLElement>(minimized ? '[data-part="expand"]' : '[data-part="minimize"]')
      ?.focus();
  });
  /** The opener to focus once the view is back. */
  const returnTo = useRef<string | null>(null);

  useLayoutEffect(() => {
    const opener = returnTo.current;
    if (opener === null || settingsFrom !== null) return;
    returnTo.current = null;
    const root = rootRef.current;
    (
      root?.querySelector<HTMLElement>(`[data-opener="${opener}"]`) ??
      root?.querySelector<HTMLElement>('[data-opener="gear"]')
    )?.focus();
  });

  const openSettings: OpenSettings = (opener) => setSettingsFrom(opener);
  const level = baseLevel(surface);

  let body: ComponentChildren;
  // The Undo notice shows with the list, and it also stays when another state replaces the list.
  let showDock = state.kind !== 'ready' && state.undo != null;
  if (minimized) {
    showDock = false;
    body = <MinimizedBar status={barStatus(state)} onExpand={() => setMinimized(false)} />;
  } else if (settingsFrom !== null) {
    showDock = false;
    body = (
      <SettingsPanel
        data={props.settings}
        level={level}
        onChange={(next) => actions.saveSettings(next)}
        onToolsChange={(next) => actions.saveTools(next)}
        onBack={() => {
          returnTo.current = settingsFrom;
          setSettingsFrom(null);
        }}
      />
    );
  } else if (state.kind === 'ready' && state.view.scopeCourseHidden) {
    showDock = false;
    // The note on the home page of a course the student hid (design decision 4).
    body = (
      <NoticeLine
        text={t('hiddenCourseHere')}
        action={t('settings')}
        opener="note"
        onAction={() => openSettings('note')}
      />
    );
  } else if (state.kind === 'ready') {
    showDock = false;
    body = (
      <ReadyView
        surface={surface}
        state={state}
        actions={actions}
        rootRef={rootRef}
        scrollMemory={
          surface === 'inpage'
            ? {
                tasks: scrollMemory.current,
                announcements: announcementsScroll.current,
                group: groupScroll.current,
              }
            : null
        }
        announcements={props.announcements}
        settings={props.settings?.value}
        onSettings={openSettings}
        onMinimize={onMinimize}
      />
    );
  } else if (state.kind === 'loading') {
    body = (
      <LoadingView
        surface={surface}
        span={props.settings?.value.span ?? DEFAULT_SPAN}
        settings={props.settings?.value}
        actions={actions}
        onSettings={openSettings}
        onMinimize={onMinimize}
      />
    );
  } else if (state.kind === 'cant_load') {
    // The header and the arrows stay, so the student can step to a span that is cached.
    body = (
      <LoadingView
        surface={surface}
        span={props.settings?.value.span ?? DEFAULT_SPAN}
        settings={props.settings?.value}
        actions={actions}
        onSettings={openSettings}
        onMinimize={onMinimize}
        failed={
          <StateBody
            state={state}
            actions={actions}
            level={subLevel(level)}
            context="surface"
            showOffer={surface === 'panel'}
          />
        }
      />
    );
  } else {
    body = (
      <>
        <Bar level={level} onSettings={() => openSettings('gear')} onMinimize={onMinimize} />
        <StateBody
          state={state}
          actions={actions}
          level={subLevel(level)}
          context="surface"
          showOffer={surface === 'panel'}
        />
      </>
    );
  }
  return (
    <div
      class="wr"
      data-surface={surface}
      data-rows={rowSize}
      data-minimized={minimized ? '' : undefined}
      aria-busy={settingsFrom === null && state.kind === 'loading' ? true : undefined}
      ref={rootRef}
    >
      <RowSizeContext.Provider value={rowSize}>
        <OpenMemoryContext.Provider value={openMemory.current}>{body}</OpenMemoryContext.Provider>
      </RowSizeContext.Provider>
      {showDock && (
        <Dock
          undo={state.undo ?? null}
          onUndo={() => actions.undo()}
          onClose={() => actions.dismissUndo()}
        />
      )}
    </div>
  );
}

/**
 * Loading before any data: the header keeps its final layout and works, and a spinner shows, as
 * in Canvas's To Do. The student can already pick a span or step to another one. After a failed
 * load, `failed` replaces the spinner, and the header works the same way, with Today on, because
 * the span on screen is not known.
 */
function LoadingView(props: {
  surface: SurfaceKind;
  span: Span;
  settings: Settings | undefined;
  actions: Actions;
  onSettings: OpenSettings;
  onMinimize?: () => void;
  failed?: ComponentChildren;
}) {
  const { settings, actions } = props;
  return (
    <>
      <Header
        view={null}
        level={baseLevel(props.surface)}
        refreshing={false}
        addDisabledReason={null}
        span={props.span}
        onSpan={settings ? (span) => actions.saveSettings({ ...settings, span }) : null}
        onStep={(delta) => actions.stepSpan(delta)}
        todayEnabled={props.failed !== undefined}
        onToday={() => actions.goToSpan(0)}
        onAdd={() => undefined}
        onSettings={() => props.onSettings('gear')}
        onMinimize={props.onMinimize}
      />
      {props.failed ?? (
        <div class="wr-state">
          <Spinner text={t('loading')} />
        </div>
      )}
    </>
  );
}

/**
 * Ctrl+Z (Cmd+Z on a Mac) undoes while the Undo notice shows (design decision 6). The key works
 * anywhere in the surface root, the panel document or the in-page shadow root, but never in a
 * text field. The listener is in place as soon as the notice is on screen, so a fast key press
 * right after the action is not lost.
 */
function useUndoShortcut(
  rootRef: RefObject<HTMLDivElement | null>,
  active: boolean,
  onUndo: () => void,
): void {
  const latest = useRef(onUndo);
  latest.current = onUndo;
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!active || !root) return;
    const scope = root.getRootNode() as Document | ShadowRoot;
    const onKeyDown = (event: Event) => {
      if (!isUndoShortcut(event as KeyboardEvent)) return;
      event.preventDefault();
      latest.current();
    };
    scope.addEventListener('keydown', onKeyDown);
    return () => scope.removeEventListener('keydown', onKeyDown);
  }, [rootRef, active]);
}

/**
 * Keeps `--wr-inset-top` and `--wr-inset-bottom` on the root at the heights of the sticky header
 * (side panel only) and the sticky dock. The stylesheet turns them into scroll margins, so a
 * focused control never hides under either (WCAG 2.4.11).
 */
function useStickyInsets(
  rootRef: RefObject<HTMLDivElement | null>,
  surface: SurfaceKind,
  enabled: boolean,
): void {
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !enabled) return;
    const header = surface === 'panel' ? root.querySelector<HTMLElement>('.wr-header') : null;
    const dock = root.querySelector<HTMLElement>('.wr-dock');
    const update = () => {
      root.style.setProperty('--wr-inset-top', `${header?.offsetHeight ?? 0}px`);
      root.style.setProperty('--wr-inset-bottom', `${dock?.offsetHeight ?? 0}px`);
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    for (const element of [header, dock]) if (element) observer?.observe(element);
    return () => {
      observer?.disconnect();
      root.style.removeProperty('--wr-inset-top');
      root.style.removeProperty('--wr-inset-bottom');
    };
  }, [rootRef, surface, enabled]);
}

function ReadyView(props: {
  surface: SurfaceKind;
  state: ReadyState;
  actions: Actions;
  rootRef: RefObject<HTMLDivElement | null>;
  /** The scroll position of each tab, for the in-page list. The side panel scrolls as a page. */
  scrollMemory: Record<ListTab | 'group', ScrollMemory> | null;
  /** The Announcements tab, or `undefined` on a surface without the tabs. */
  announcements: AppProps['announcements'];
  /** The saved settings, or `undefined` until they load. */
  settings: Settings | undefined;
  onSettings: OpenSettings;
  onMinimize?: () => void;
}) {
  const { surface, state, actions, rootRef } = props;
  const { view } = state;
  const saved = props.settings;
  const level = baseLevel(surface);
  const [form, setForm] = useState<TaskFormMode | null>(null);
  // The open bottom group is a saved setting, the same for every span and every surface. The side
  // panel has no bottom bar and ignores it.
  const openBottom: BottomKind | null = surface === 'inpage' ? (saved?.openGroup ?? null) : null;
  const setOpenBottom = saved
    ? (kind: BottomKind | null) => actions.saveSettings({ ...saved, openGroup: kind })
    : null;
  /** A new task waits for Canvas, or the last try to save one failed. */
  const [save, setSave] = useState<'idle' | 'saving' | 'failed'>('idle');
  const [notes, setNotes] = useState<OneTimeNote[]>([]);
  const [limitedId] = useState(() => newId('limited'));
  const [tabIds] = useState(() => newIds('tab', ['tasks', 'announcements', 'panel'] as const));
  const ann = props.announcements;
  const tab: ListTab = ann?.tab ?? 'tasks';
  /** The row that Undo brings back, and until when focus follows it. */
  const restoredRow = useRef<{ key: string; until: number } | null>(null);
  /** Where focus goes when the form closes. The list is re-created, so this is a selector. */
  const returnFocus = useRef<string | null>(null);
  /** The last focused control outside the notices. Focus goes back there when a notice closes. */
  const lastFocus = useRef<HTMLElement | null>(null);

  // Reading focus during render is safe: it only records which control had focus before this update.
  const snapshot = useRef<FocusSnapshot | null>(null);
  snapshot.current = captureFocus(rootRef.current);
  /** The first render replaces another view, such as the settings, which handles its own focus. */
  const mounted = useRef(false);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (mounted.current)
      restoreFocus(root, snapshot.current, () =>
        root === null
          ? null
          : (usable(root, lastFocus.current) ??
            root.querySelector<HTMLElement>('.wr-add') ??
            firstRowControl(root)),
      );
    mounted.current = true;
    if (returnFocus.current !== null && form === null) {
      root?.querySelector<HTMLElement>(returnFocus.current)?.focus();
      returnFocus.current = null;
    }
  });

  /** Undo of a read mark brings the row back, and focus goes to it (WCAG 2.4.3). */
  const undo = () => {
    const target = state.undo?.target;
    if (target !== undefined) restoredRow.current = { key: target, until: Date.now() + 1500 };
    actions.undo();
  };
  useLayoutEffect(() => {
    const pending = restoredRow.current;
    const root = rootRef.current;
    if (pending === null || root === null) return;
    if (Date.now() > pending.until) {
      restoredRow.current = null;
      return;
    }
    const row = [...root.querySelectorAll<HTMLElement>('[data-row-key]')].find(
      (element) => element.dataset.rowKey === pending.key,
    );
    const control =
      row?.querySelector<HTMLElement>('[data-part="mark"]') ??
      row?.querySelector<HTMLElement>('[data-part="title"]');
    if (control === null || control === undefined) return;
    restoredRow.current = null;
    control.focus();
  });
  useUndoShortcut(rootRef, form === null && state.undo !== null, undo);
  useStickyInsets(rootRef, surface, form === null);
  // The side panel has no list that scrolls: its page does, so the task panel is the list there.
  // The card, the dock and the widgets pull in the lists that own the scroll, which mount and
  // leave with the view.
  usePull(rootRef, '.wr-task-panel', false, surface === 'panel' && form === null);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && !target.closest('.wr-dock, .wr-notices')) lastFocus.current = target;
    };
    root.addEventListener('focusin', onFocusIn);
    return () => root.removeEventListener('focusin', onFocusIn);
  }, [rootRef]);

  const showNote = (note: OneTimeNote) => {
    if (state.seenNotes[note]) return;
    setNotes((current) => (current.includes(note) ? current : [...current, note]));
  };

  const openForm = (mode: TaskFormMode) => setForm(mode);

  /** Creates a task. The form stays open until Canvas answers, so a slow save is never sent twice. */
  const createTask = async (input: TaskInput) => {
    setSave('saving');
    if (await actions.createTask(input)) closeForm(null);
    else setSave('failed');
  };
  /** Closes the form and focuses the control that opened it, or the Add button. */
  const closeForm = (focusKey: string | null) => {
    returnFocus.current = focusKey
      ? `[data-row-key="${focusKey.replace(/["\\]/g, '\\$&')}"] [data-part="title"]`
      : '.wr-add';
    setSave('idle');
    setForm(null);
  };

  const handlers: ListHandlers = {
    onToggleDone(item, done) {
      actions.setDone(item.key, done);
      if (done) showNote('firstDone');
    },
    onMoveToToday(item) {
      if (item.noteId !== null) actions.moveTaskToToday(item.noteId);
    },
    onOpen(item) {
      actions.openItem(item.key);
    },
    onEditNote(item: ItemView) {
      openForm({ kind: 'edit', item });
    },
    onMarkAllOlderDone() {
      actions.markAllOlderDone();
      showNote('firstDone');
    },
  };

  /**
   * The notices in priority order (design decision 19). A notice the student can close comes
   * before the lines that stay until the cause goes away, so none of them waits for ever.
   */
  const notices: ComponentChildren[] = [];
  // The offer is for the side panel only (design decision 4).
  if (surface === 'panel' && state.offer)
    notices.push(
      <OfferBanner
        key="offer"
        offer={state.offer}
        mode="switch"
        region={false}
        onAccept={(origin) => actions.acceptOffer(origin)}
        onDismiss={() => actions.dismissOffer()}
      />,
    );
  for (const note of notes.filter((n) => !state.seenNotes[n]))
    notices.push(
      <NoticeLine
        key={note}
        text={noteText(note)}
        action={t('gotIt')}
        onAction={() => {
          actions.markNoteSeen(note);
          setNotes((current) => current.filter((n) => n !== note));
        }}
      />,
    );
  if (state.stale)
    notices.push(
      <NoticeLine
        key="stale"
        text={staleText(state.stale.since, state.stale.offline, view)}
        action={t('retry')}
        onAction={() => actions.retry()}
      />,
    );
  if (state.skippedCourses.length > 0)
    notices.push(
      <NoticeLine
        key="skipped"
        text={t('skippedCourses', joinNames(state.skippedCourses.map((course) => course.name)))}
        // Retry shows only when the stale line does not already offer it.
        action={state.stale === null ? t('retry') : undefined}
        onAction={() => actions.retry()}
      />,
    );
  if (view.limited)
    notices.push(<NoticeLine key="limited" id={limitedId} text={t('limitedLine')} />);
  const filter = filterText(view, state.taskCourses);
  const footer = (
    <>
      {view.hiddenCourseCount > 0 && (
        <div class="wr-foot">
          <NoticeLine
            text={tp('hiddenCourses', view.hiddenCourseCount)}
            action={t('settings')}
            opener="hidden"
            onAction={() => props.onSettings('hidden')}
          />
        </div>
      )}
    </>
  );
  const groups = (
    <>
      <div aria-busy={state.refreshing}>
        <WeekList
          view={view}
          level={subLevel(level)}
          handlers={handlers}
          part={surface === 'inpage' ? 'days' : undefined}
        />
      </div>
      {surface === 'panel' && footer}
    </>
  );
  /**
   * Changing the tab keeps the scroll position of the tab that the student leaves. A hidden day
   * list, under an open bottom group, has no position to read: its memory is already right.
   */
  const selectTab = (next: ListTab) => {
    const region = rootRef.current?.querySelector<HTMLElement>('.wr-scroll');
    if (props.scrollMemory !== null && region && !region.hidden)
      props.scrollMemory[tab].top = region.scrollTop;
    actions.setListTab(next);
  };
  const content =
    tab === 'announcements' && ann !== undefined ? (
      <Announcements data={ann} view={view} origin={state.origin} actions={actions} />
    ) : (
      groups
    );
  /** The bottom group that fills the list area, in place of the days. */
  const shownGroup = surface === 'inpage' && tab === 'tasks' ? openBottom : null;
  const spanKey = `${view.span.kind}:${view.span.days}:${view.spanStart}`;
  const scrolling = props.scrollMemory ? (
    <ScrollRegion
      hidden={shownGroup !== null}
      memory={props.scrollMemory[tab]}
      resetKey={tab === 'tasks' ? spanKey : 'announcements'}
      label={tab === 'tasks' ? t('scrollRegionLabel') : t('feedRegion')}
    >
      {content}
    </ScrollRegion>
  ) : (
    content
  );

  if (form !== null) {
    return (
      <TaskForm
        mode={form}
        view={view}
        courses={state.taskCourses}
        level={level}
        saving={save === 'saving'}
        saveFailed={save === 'failed'}
        onSubmit={(input) => {
          if (form.kind === 'edit' && form.item.noteId !== null) {
            actions.updateTask(form.item.noteId, input);
            closeForm(form.item.key);
          } else {
            void createTask(input);
          }
        }}
        onDelete={(noteId) => {
          actions.deleteTask(noteId);
          closeForm(null);
        }}
        onCancel={() => closeForm(form.kind === 'edit' ? form.item.key : null)}
      />
    );
  }

  return (
    <>
      <Header
        view={view}
        level={level}
        refreshing={state.refreshing}
        addDisabledReason={view.limited ? t('limitedLine') : null}
        addDescribedBy={limitedId}
        span={saved?.span ?? view.span}
        onSpan={saved ? (span) => actions.saveSettings({ ...saved, span }) : null}
        onStep={(delta) => actions.stepSpan(delta)}
        onToday={() => actions.goToSpan(0)}
        onAdd={() => openForm({ kind: 'new' })}
        onSettings={() => props.onSettings('gear')}
        onMinimize={props.onMinimize}
      />
      <NoticeQueue notices={notices} />
      {/* The Add button names the limited line as its reason, also while that line waits. */}
      {view.limited && notices.length > 1 && (
        <span id={limitedId} hidden>
          {t('limitedLine')}
        </span>
      )}
      <Rings
        rings={view.rings}
        span={view.span}
        filter={view.courseFilter}
        loading={view.loading || view.incomplete}
        onSelect={(id) => actions.setCourseFilter(id)}
      />
      {filter !== null && (
        <div class="wr-filter">
          <NoticeLine
            text={filter}
            action={t('showAll')}
            onAction={() => actions.setCourseFilter(undefined)}
          />
        </div>
      )}
      {ann !== undefined && (
        <ListTabs
          tab={tab}
          unread={ann.feed?.status === 'ready' ? ann.feed.unread : null}
          ids={tabIds}
          onSelect={selectTab}
        />
      )}
      <div
        class="wr-task-panel"
        role={ann === undefined ? undefined : 'tabpanel'}
        id={tabIds.panel}
        aria-labelledby={ann === undefined ? undefined : tabId(tabIds, tab)}
      >
        {scrolling}
        {props.scrollMemory !== null && tab === 'tasks' && (
          <GroupArea kind={shownGroup} memory={props.scrollMemory.group} resetKey={spanKey}>
            {shownGroup !== null && (
              <GroupView
                key={shownGroup}
                view={view}
                kind={shownGroup}
                level={subLevel(level)}
                handlers={handlers}
                onRetry={() => actions.retry()}
              />
            )}
          </GroupArea>
        )}
        <Dock undo={state.undo} onUndo={undo} onClose={() => actions.dismissUndo()} />
        {surface === 'inpage' && tab === 'tasks' && (
          <div class="wr-pinned" aria-busy={state.refreshing}>
            <ViewSwitch view={view} open={openBottom} onSelect={setOpenBottom} />
            {footer}
          </div>
        )}
      </div>
    </>
  );
}
