/**
 * The Announcements tab of the weekly list (design decision 24). It lists the announcements of
 * the last 14 days, newest first, with the unread ones marked. A row opens in place to the full
 * message, which goes through the strict sanitizer. Opening a row never marks it as read: the
 * "Mark as read" control of an unread row is the only thing that does.
 */
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { t } from '../../../shared/ui/i18n';
import { htmlToText, sanitizeHtml } from '../../../shared/ui/sanitize';
import { CheckIcon } from '../../../shared/ui/icons';
import { Switch, newId } from '../../../shared/ui/parts';
import { announcementKey, type AnnouncementRow } from '../data/announcements';
import type { WeekView } from '../model/types';
import type { Actions, AnnouncementsProps } from './contract';
import { formatDateTime, formatMonthDay, zonedDate } from './format';
import { Spinner } from './States';

/** How many characters of a message the two-line preview reads. */
const SNIPPET_CHARS = 280;
const DAY_MS = 24 * 60 * 60 * 1000;

/** "Today", "Yesterday", "3 days ago", or the date for anything older. */
export function relativeDate(postedAt: string, view: Pick<WeekView, 'today' | 'timeZone'>): string {
  const day = zonedDate(postedAt, view.timeZone);
  const days = Math.round((Date.parse(view.today) - Date.parse(day)) / DAY_MS);
  if (days <= 0) return t('feedToday');
  if (days === 1) return t('feedYesterday');
  return days <= 14 ? t('feedDaysAgo', String(days)) : formatMonthDay(day);
}

type MessageState = { kind: 'loading' } | { kind: 'ready'; html: string } | { kind: 'failed' };

/** The sanitized message. The nodes are built once for a message, so a redraw keeps the selection. */
function Message(props: { html: string; origin: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const box = ref.current;
    if (box === null) return;
    box.replaceChildren(sanitizeHtml(props.html, { origin: props.origin, doc: box.ownerDocument }));
  }, [props.html, props.origin]);
  return <div class="wr-ann-body" ref={ref} />;
}

function AnnouncementItem(props: {
  row: AnnouncementRow;
  view: WeekView;
  origin: string;
  showCourse: boolean;
  actions: Actions;
}) {
  const { row, view, actions } = props;
  const [ids] = useState(() => ({ body: newId('ann') }));
  const [message, setMessage] = useState<MessageState | null>(null);
  const open = message !== null;
  const snippet = htmlToText(row.message, SNIPPET_CHARS);
  const key = announcementKey(row.courseId, row.id);
  /** The row that the student closed or opened last, so a late reply of another open is dropped. */
  const opened = useRef(0);

  const show = () => {
    opened.current += 1;
    const mine = opened.current;
    setMessage({ kind: 'loading' });
    actions
      .loadAnnouncementMessage(row.courseId, row.id)
      .then((html) => {
        if (opened.current !== mine) return;
        setMessage(html === null ? { kind: 'failed' } : { kind: 'ready', html });
      })
      .catch(() => {
        if (opened.current === mine) setMessage({ kind: 'failed' });
      });
  };
  const hide = () => {
    opened.current += 1;
    setMessage(null);
  };

  return (
    <li
      class={row.read ? 'wr-ann' : 'wr-ann is-unread'}
      data-row-key={key}
      style={{ '--wr-course': row.color }}
    >
      <div class="wr-ann-head">
        {!row.read && <span class="wr-sr">{t('feedUnread')}</span>}
        <span class="wr-ann-dot" aria-hidden="true" />
        {props.showCourse && <span class="wr-ann-course">{row.courseCode}</span>}
        <time
          class="wr-ann-when"
          dateTime={row.postedAt}
          title={formatDateTime(row.postedAt, view.timeZone, view.hourCycle)}
        >
          {relativeDate(row.postedAt, view)}
        </time>
      </div>
      <button
        type="button"
        class="wr-ann-title"
        data-part="title"
        aria-expanded={open}
        aria-controls={ids.body}
        onClick={open ? hide : show}
      >
        {row.title}
      </button>
      {row.author !== null && <div class="wr-ann-author">{row.author}</div>}
      <div id={ids.body}>
        {open ? (
          <>
            {message.kind === 'loading' && <Spinner text={t('feedMessageLoading')} />}
            {message.kind === 'failed' && <p class="wr-error">{t('feedMessageFailed')}</p>}
            {message.kind === 'ready' && <Message html={message.html} origin={props.origin} />}
          </>
        ) : (
          snippet !== '' && <p class="wr-ann-snippet">{snippet}</p>
        )}
      </div>
      <div class="wr-ann-actions">
        {!row.read && (
          <button
            type="button"
            class="wr-ann-read"
            data-part="mark"
            aria-label={t('feedMarkReadItem', row.title)}
            onClick={() => actions.markAnnouncementRead(row.courseId, row.id)}
          >
            <span class="wr-ann-circle" aria-hidden="true">
              <CheckIcon />
            </span>
            {t('feedMarkRead')}
          </button>
        )}
        {open && (
          <>
            <button type="button" class="wr-link-btn" data-part="less" onClick={hide}>
              {t('feedShowLess')}
            </button>
            <button
              type="button"
              class="wr-link-btn"
              data-part="open"
              title={t('feedOpenNote')}
              onClick={() => actions.openAnnouncement(row.courseId, row.id)}
            >
              {t('feedOpen')}
            </button>
          </>
        )}
      </div>
      {open && !row.read && <p class="wr-ann-note">{t('feedOpenNote')}</p>}
    </li>
  );
}

/** Placeholders while the first load runs, in the style of the days of the Tasks tab. */
function Loading() {
  return (
    <div aria-busy="true">
      <p class="wr-sr" role="status">
        {t('feedLoading')}
      </p>
      <ul class="wr-items wr-skel-list" aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <li class="wr-skel-row" key={index}>
            <span class="wr-skel-bar wr-skel-tall" />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Announcements(props: {
  data: AnnouncementsProps;
  view: WeekView;
  origin: string;
  actions: Actions;
}) {
  const { data, view, actions } = props;
  const [switchId] = useState(() => newId('read'));
  const [labelId] = useState(() => newId('read-label'));
  const feed = data.feed;
  const ready = feed?.status === 'ready' ? feed : null;
  const rows = ready === null ? [] : data.showRead ? ready.rows : ready.rows.filter((r) => !r.read);

  let body;
  if (ready === null || (ready.loading && ready.rows.length === 0)) {
    body = <Loading />;
  } else if (ready.failed) {
    body = (
      <div class="wr-state">
        <p class="wr-state-body" role="status">
          {t('feedFailed')}
        </p>
        <div class="wr-state-actions">
          <button type="button" class="wr-btn" onClick={() => actions.retryAnnouncements()}>
            {t('retry')}
          </button>
        </div>
      </div>
    );
  } else if (rows.length === 0) {
    body = (
      <p class="wr-empty">
        <CheckIcon />
        {ready.rows.length > 0 ? t('feedEmptyUnread') : t('feedEmpty')}
      </p>
    );
  } else {
    body = (
      <ul class="wr-items wr-anns">
        {rows.map((row) => (
          <AnnouncementItem
            key={announcementKey(row.courseId, row.id)}
            row={row}
            view={view}
            origin={props.origin}
            showCourse={view.scopeCourseId === null}
            actions={actions}
          />
        ))}
      </ul>
    );
  }

  return (
    <div class="wr-ann-view">
      <div class="wr-ann-bar">
        <span id={labelId} class="wr-ann-bar-label">
          {t('showRead')}
        </span>
        <Switch
          id={switchId}
          checked={data.showRead}
          labelledBy={labelId}
          onChange={(checked) => actions.setShowRead(checked)}
        />
      </div>
      {body}
    </div>
  );
}
