/**
 * The list surface for the side panel and the Canvas page. It renders props and calls actions.
 * The gear opens the settings in place (design decision 18); Back returns to the view and to
 * the control that opened them.
 */
import type { ComponentChildren, RefObject } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { t, tp } from '../../../shared/ui/i18n';
import {
  DEFAULT_SPAN,
  type ItemView,
  type Settings,
  type Span,
  type SurfaceState,
} from '../model/types';
import type { Actions, AppProps, SurfaceKind, TaskInput } from './contract';
import { Header } from './Header';
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
import { Bar, newId, type HeadingLevel } from '../../../shared/ui/parts';
import { Rings } from './Rings';
import { SettingsPanel } from './Settings';
import { Spinner, StateBody } from './States';
import { TaskForm, type TaskFormMode } from './TaskForm';
import { useGlance, WeekList, type Glance, type ListHandlers } from './WeekList';
import { captureFocus, firstRowControl, restoreFocus, usable, type FocusSnapshot } from './focus';

type ReadyState = Extract<SurfaceState, { kind: 'ready' }>;

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
  const glance = useGlance();
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
  if (settingsFrom !== null) {
    body = (
      <SettingsPanel
        data={props.settings}
        level={level}
        onChange={(next) => actions.saveSettings(next)}
        onBack={() => {
          returnTo.current = settingsFrom;
          setSettingsFrom(null);
        }}
      />
    );
  } else if (state.kind === 'ready' && state.view.scopeCourseHidden) {
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
    body = (
      <ReadyView
        surface={surface}
        state={state}
        actions={actions}
        rootRef={rootRef}
        glance={surface === 'inpage' ? glance : undefined}
        settings={props.settings?.value}
        onSettings={openSettings}
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
        <Bar level={level} onSettings={() => openSettings('gear')} />
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
      aria-busy={settingsFrom === null && state.kind === 'loading' ? true : undefined}
      ref={rootRef}
    >
      {body}
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
  glance: Glance | undefined;
  /** The saved settings, or `undefined` until they load. */
  settings: Settings | undefined;
  onSettings: OpenSettings;
}) {
  const { surface, state, actions, rootRef } = props;
  const { view } = state;
  const saved = props.settings;
  const level = baseLevel(surface);
  const [form, setForm] = useState<TaskFormMode | null>(null);
  /** A new task waits for Canvas, or the last try to save one failed. */
  const [save, setSave] = useState<'idle' | 'saving' | 'failed'>('idle');
  const [notes, setNotes] = useState<OneTimeNote[]>([]);
  const [limitedId] = useState(() => newId('limited'));
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

  useUndoShortcut(rootRef, form === null && state.undo !== null, () => actions.undo());
  useStickyInsets(rootRef, surface, form === null);
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
    onSkip(item) {
      actions.skip(item.key);
      showNote('firstSkip');
    },
    onUnskip(item) {
      actions.unskip(item.key);
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
    onSkipAllOlder() {
      actions.skipAllOlder();
      showNote('firstSkip');
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
        loading={view.loading}
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
      <div aria-busy={state.refreshing}>
        <WeekList view={view} level={subLevel(level)} handlers={handlers} glance={props.glance} />
      </div>
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
      <Dock undo={state.undo} onUndo={() => actions.undo()} onClose={() => actions.dismissUndo()} />
    </>
  );
}
