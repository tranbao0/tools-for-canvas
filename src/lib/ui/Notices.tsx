/** Lines and banners around the list: offer, notice lines, one-time notes and the Undo dock. */
import type { ComponentChildren } from 'preact';
import { t, tp, type MessageKey, type PluralKey } from '../i18n';
import type { ItemView, Offer, UndoInfo, WeekView } from '../model/types';
import { formatTimeOrDateTime, hostOf } from './format';
import { CloseIcon } from './icons';
import { browserIsOffline } from './online';
import { HostText } from './parts';
import { ringName } from './Rings';

export function OfferBanner(props: {
  offer: Offer;
  onAccept(origin: string): void;
  onDismiss(): void;
}) {
  const { offer } = props;
  const use = offer.mode === 'use';
  return (
    <div class="wr-box" role="region" aria-label={use ? t('offerUse') : t('offerSwitch')}>
      <div>
        <p class="wr-offer-title">{use ? t('offerUse') : t('offerSwitch')}</p>
        <HostText class="wr-offer-host" host={hostOf(offer.origin)} />
      </div>
      <div class="wr-offer-actions">
        <button
          type="button"
          class="wr-btn wr-btn-primary wr-btn-small"
          onClick={() => props.onAccept(offer.origin)}
        >
          {use ? t('offerUseButton') : t('offerSwitchButton')}
        </button>
        <button type="button" class="wr-link-btn" onClick={props.onDismiss}>
          {t('notNow')}
        </button>
      </div>
    </div>
  );
}

/** "Couldn't refresh. Showing your list from 3:05 pm." with Retry. */
export function staleText(since: string, offline: boolean, view: WeekView): string {
  const time = formatTimeOrDateTime(since, view.today, view.timeZone, view.hourCycle);
  const line = t('staleLine', time);
  // A network error with a working connection usually means Canvas is down, not that the student is offline.
  return offline && browserIsOffline() ? `${t('offline')} ${line}` : line;
}

/**
 * One line of quiet text with an optional link-style action: the stale, skipped-course, limited,
 * filter, hidden-course and hidden-course-note lines. `opener` is the `data-opener` that focus
 * returns to when the action opens the settings in place.
 */
export function NoticeLine(props: {
  text: ComponentChildren;
  action?: string;
  onAction?(): void;
  opener?: string;
  role?: 'status';
  id?: string;
}) {
  return (
    <p class="wr-notice" role={props.role} id={props.id}>
      <span>{props.text}</span>
      {props.action !== undefined && (
        <button
          type="button"
          class="wr-link-btn"
          data-opener={props.opener}
          onClick={props.onAction}
        >
          {props.action}
        </button>
      )}
    </p>
  );
}

/** "BIO 110", "BIO 110 and CHEM 120", or "BIO 110, CHEM 120 and HIST 205". */
export function joinNames(names: readonly string[]): string {
  const last = names.at(-1);
  if (last === undefined) return '';
  if (names.length === 1) return last;
  return t('listAnd', names.slice(0, -1).join(', '), last);
}

function groupItems(view: WeekView): ItemView[] {
  return view.groups.flatMap((group) => [
    ...group.items,
    ...group.older,
    ...group.skipped,
    ...group.doneUndated,
  ]);
}

/**
 * The name of the filtered course: from its ring, else from an item of the view (the rings may
 * be off), else from the course list. `null` when there is no filter or no name.
 */
export function filterName(
  view: WeekView,
  courses: readonly { id: string; name: string }[],
): string | null {
  const filter = view.courseFilter;
  if (filter === undefined) return null;
  if (filter === null) return t('personal');
  const ring = view.rings.find((r) => r.courseId === filter);
  if (ring) return ringName(ring);
  const item = groupItems(view).find((entry) => entry.courseId === filter);
  if (item) return item.contextLabel;
  return courses.find((course) => course.id === filter)?.name ?? null;
}

/** "Showing BIO 110 only.", or `null` when the list has no course filter. */
export function filterText(
  view: WeekView,
  courses: readonly { id: string; name: string }[],
): string | null {
  if (view.courseFilter === undefined) return null;
  const name = filterName(view, courses);
  return name === null ? t('filterShowingOne') : t('filterShowing', name);
}

const UNDO_TEXT = {
  done: 'undoDone',
  skipped: 'undoSkipped',
  skipped_all: 'undoSkippedAll',
  deleted: 'undoDeleted',
} as const satisfies Record<UndoInfo['kind'], PluralKey>;

export type OneTimeNote = 'firstDone' | 'firstSkip';

const NOTE_TEXT = {
  firstDone: 'noteFirstDone',
  firstSkip: 'noteFirstSkip',
} as const satisfies Record<OneTimeNote, MessageKey>;

/**
 * One-time notes, inline at the top of the list (design decision 19), until the student confirms
 * them. The container stays in the page while it is empty, so screen readers announce a new note.
 */
export function OneTimeNotes(props: { notes: OneTimeNote[]; onSeen(note: OneTimeNote): void }) {
  return (
    <div class="wr-notes" role="status">
      {props.notes.map((note) => (
        <div key={note} class="wr-box">
          <p>{t(NOTE_TEXT[note])}</p>
          <button
            type="button"
            class="wr-btn wr-btn-small"
            data-note={note}
            onClick={() => props.onSeen(note)}
          >
            {t('gotIt')}
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * The sticky bottom dock with the Undo notice. It is a live region, so screen readers announce
 * the notice. The notice has no timer: it stays until the student acts again or closes it.
 * Ctrl+Z (Cmd+Z on a Mac) also undoes while it shows; `App` handles that key.
 */
export function Dock(props: { undo: UndoInfo | null; onUndo(): void; onClose(): void }) {
  return (
    <div class="wr-dock" role="status" aria-live="polite">
      {props.undo && (
        <div class="wr-toast">
          <span class="wr-toast-text">{tp(UNDO_TEXT[props.undo.kind], props.undo.count)}</span>
          <button
            type="button"
            class="wr-link-btn wr-toast-action"
            data-part="undo"
            aria-keyshortcuts="Control+Z Meta+Z"
            onClick={props.onUndo}
          >
            {t('undo')}
          </button>
          <button
            type="button"
            class="wr-icon-btn"
            data-part="close-undo"
            aria-label={t('closeNotice')}
            title={t('closeNotice')}
            onClick={props.onClose}
          >
            <CloseIcon />
          </button>
        </div>
      )}
    </div>
  );
}

/** Elements that take typed text, where Ctrl+Z belongs to the field. */
const TEXT_FIELD = [
  'textarea',
  '[contenteditable]:not([contenteditable="false"])',
  'input:not([type="button"], [type="checkbox"], [type="color"], [type="file"], [type="image"], [type="radio"], [type="range"], [type="reset"], [type="submit"])',
].join(', ');

/** Ctrl+Z, or Cmd+Z on a Mac, outside a text field and outside an IME composition. */
export function isUndoShortcut(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing || event.altKey || event.shiftKey) return false;
  if (!event.ctrlKey && !event.metaKey) return false;
  if (event.key !== 'z' && event.key !== 'Z') return false;
  const target = (event.composedPath()[0] ?? event.target) as Element | null;
  return target?.matches?.(TEXT_FIELD) !== true;
}
