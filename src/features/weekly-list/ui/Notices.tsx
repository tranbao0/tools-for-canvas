/** Lines and banners around the list: offer, notice lines, one-time notes, the notice queue and the Undo dock. */
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { t, tp, type MessageKey, type PluralKey } from '../../../shared/ui/i18n';
import type { ItemView, Offer, UndoInfo, WeekView } from '../model/types';
import { formatTimeOrDateTime, hostOf } from './format';
import { CloseIcon } from '../../../shared/ui/icons';
import { HostText, MARKER, withNode } from '../../../shared/ui/parts';
import { ringName } from './Rings';

/** The browser says it has no network. `navigator.onLine` is `true` when it does not know. */
export function browserIsOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/** How long the accept button stays off after the offer shows or its host changes. */
export const OFFER_ARM_MS = 1000;

interface OfferProps {
  offer: Offer;
  mode: 'use' | 'switch';
  onAccept(origin: string): void;
  onDismiss(): void;
  /**
   * Whether the offer is a labelled region of its own. In the notice queue it is not: the live
   * region around it already announces it.
   */
  region?: boolean;
}

/**
 * The offer of a Canvas that the detector found. With no address saved (`use`), it reads "Use
 * canvas.school.edu as your Canvas?" with a "Use it" button. With an address saved (`switch`), it
 * reads "Switch to this Canvas?" with the host under it. The host name is the real one, which a
 * page cannot change here: only extension pages show the offer.
 *
 * A page can load again and replace the offer while the student reads it, so a new host is a new
 * element (the key), and the accept button stays off for a second after the offer shows or its
 * host changes. A click that was aimed at the old host then does nothing.
 */
export function OfferBanner(props: OfferProps) {
  return <OfferBox key={props.offer.origin} {...props} />;
}

function OfferBox(props: OfferProps) {
  const { offer } = props;
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setArmed(true), OFFER_ARM_MS);
    return () => clearTimeout(timer);
  }, []);
  const host = hostOf(offer.origin);
  const use = props.mode === 'use';
  return (
    <div
      class="wr-offer"
      role={props.region === false ? undefined : 'region'}
      aria-label={props.region === false ? undefined : use ? t('offerUse', host) : t('offerSwitch')}
    >
      <div>
        {use ? (
          <p class="wr-offer-title">
            {withNode(t('offerUse', MARKER), MARKER, <HostText host={host} />)}
          </p>
        ) : (
          <>
            <p class="wr-offer-title">{t('offerSwitch')}</p>
            <HostText class="wr-offer-host" host={host} />
          </>
        )}
      </div>
      <div class="wr-offer-actions">
        <button
          type="button"
          class="wr-btn wr-btn-primary wr-btn-small"
          aria-disabled={!armed}
          onClick={() => {
            if (armed) props.onAccept(offer.origin);
          }}
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
  id?: string;
}) {
  return (
    <p class="wr-notice" id={props.id}>
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
  announcement_read: 'undoAnnouncementRead',
} as const satisfies Record<UndoInfo['kind'], PluralKey>;

export type OneTimeNote = 'firstDone' | 'firstSkip';

const NOTE_TEXT = {
  firstDone: 'noteFirstDone',
  firstSkip: 'noteFirstSkip',
} as const satisfies Record<OneTimeNote, MessageKey>;

/**
 * The notice queue at the top of the list (design decision 19): one slim notice at a time, the
 * first of `notices`, which the caller sorts by priority. The others wait behind it, and a quiet
 * line counts them. The live region holds the front notice only and stays in the page while it
 * is empty, so screen readers announce each notice that comes up. The count sits outside it, so
 * a change of the count does not read the front notice again.
 */
export function NoticeQueue(props: { notices: ComponentChildren[] }) {
  const [first, ...waiting] = props.notices;
  return (
    <>
      <div class="wr-notices" role="status">
        {first}
      </div>
      {waiting.length > 0 && <p class="wr-notices-more">{tp('moreNotices', waiting.length)}</p>}
    </>
  );
}

/** The text of a one-time note, for the notice queue. */
export function noteText(note: OneTimeNote): string {
  return t(NOTE_TEXT[note]);
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
