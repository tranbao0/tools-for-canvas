/**
 * Announcements in place (design decision 22).
 *
 * The widget cuts a title at 75 characters and the message at 120, and "Read more" leaves the
 * dashboard. This fix makes "Read more" and a click on the title open the whole message inside
 * the card, with "Show less". The message comes from the background as the HTML a teacher wrote.
 * It goes through the sanitizer (sanitize.ts) into the shadow root of a host element that the fix
 * adds to the item, so the page styles do not reach it and it cannot reach the page.
 *
 * Opening an announcement marks it as read, as the Canvas page does. The fix also adds a course
 * filter beside the read filter. The widget loads three announcements of all courses a page, so a
 * course filter cannot be applied to its list. With a course chosen, the fix hides that list and
 * its pager and shows the recent announcements of the course, which the background loads.
 */
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import {
  findAnnouncementItem,
  findAnnouncementsWidgets,
  isDarkWidget,
  type AnnouncementItem,
  type AnnouncementsWidget,
  type ReadFilter,
} from '../../../shared/canvas/widgetDashboard';
import { t } from '../../../shared/ui/i18n';
import type { AnnouncementBody, AnnouncementEntry, DashboardCourse } from '../protocol';
import type { Fix, FixContext } from './context';
import { sanitizeHtml } from './sanitize';
import { FIXES_CSS } from './styles';

const OWN = 'data-wr-own';
const MINE = `[${OWN}=ann]`;
const ATTRIBUTES = [
  'ann',
  'bar',
  'content',
  'snippet',
  'more',
  'title',
  'open',
  'gone',
  'filtered',
].map((name) => `data-wr-${name}`);

export function announcementsFix(): Fix {
  /** The announcements the student opened, which stay open while React draws the item again. */
  const open = new Set<string>();
  const bodies = new Map<string, AnnouncementBody>();
  const read = new Set<string>();
  const readSent = new Set<string>();
  const lists = new Map<string, AnnouncementEntry[] | 'loading' | 'failed'>();
  let courseId = '';
  let current: FixContext | null = null;
  let stopClicks: (() => void) | null = null;

  const keyOf = (course: string, topic: string): string => `${course}:${topic}`;

  /** The message of one announcement, with "Show less". It marks the announcement as read. */
  function Message(props: { course: string; topic: string; onClose(): void }) {
    const { course, topic } = props;
    const key = keyOf(course, topic);
    const context = current as FixContext;
    const [message, setMessage] = useState(bodies.get(key));
    const [failed, setFailed] = useState(false);
    const [marked, setMarked] = useState(read.has(key));
    useEffect(() => {
      if (message === undefined) {
        context
          .send({ type: 'weekrow:announcement', courseId: course, topicId: topic })
          .then((reply) => {
            const body = reply as AnnouncementBody | undefined;
            if (typeof body?.message !== 'string') throw new Error('No message');
            bodies.set(key, body);
            setMessage(body);
          })
          .catch(() => setFailed(true));
      }
      if (!read.has(key) && !readSent.has(key)) {
        readSent.add(key);
        context
          .send({ type: 'weekrow:announcement-read', courseId: course, topicId: topic })
          .then((reply) => {
            if ((reply as { read?: boolean } | undefined)?.read !== true)
              throw new Error('Not read');
            read.add(key);
            setMarked(true);
            context.again();
          })
          // A mark that failed is tried again the next time the student opens the announcement.
          .catch(() => readSent.delete(key));
      }
    }, [key]);
    return (
      <>
        <div
          class="wr-body"
          ref={(box) =>
            message &&
            box?.replaceChildren(
              sanitizeHtml(message.message, { origin: context.origin, doc: context.doc }),
            )
          }
        />
        <p class="wr-x-note" role="status">
          {failed ? (
            <>
              {t('annFailed')}{' '}
              <a
                class="wr-x-link"
                href={`${context.origin}/courses/${course}/discussion_topics/${topic}`}
              >
                {t('annOpenOnCanvas')}
              </a>
            </>
          ) : message === undefined ? (
            t('annLoading')
          ) : marked ? (
            t('annMarkedRead')
          ) : (
            ''
          )}
        </p>
        <button type="button" class="wr-x-link" onClick={props.onClose}>
          {t('annShowLess')}
        </button>
      </>
    );
  }

  /** Removes a host of the fix, and stops the components that it holds. */
  function unmount(node: Element): void {
    render(null, (node.shadowRoot?.lastElementChild ?? node) as HTMLElement);
    node.remove();
  }

  /** A host element with a shadow root, so the page styles and the message stay apart. */
  function shadowHost(doc: Document): { host: HTMLElement; root: HTMLElement } {
    const host = doc.createElement('div');
    host.setAttribute(OWN, 'ann');
    const shadow = host.attachShadow({ mode: 'open' });
    const style = doc.createElement('style');
    style.textContent = FIXES_CSS;
    const root = doc.createElement('div');
    shadow.append(style, root);
    return { host, root };
  }

  function setOpen(context: FixContext, key: string, on: boolean): void {
    if (on) open.add(key);
    else open.delete(key);
    context.again();
  }

  /** Shows or removes the message of a native item, as the open set says. */
  function expandNative(context: FixContext, found: AnnouncementItem): void {
    const key = keyOf(found.courseId, found.topicId);
    const hosted = found.item.querySelector<HTMLElement>(`:scope > ${MINE}`);
    found.item.toggleAttribute('data-wr-open', open.has(key));
    if (!open.has(key)) {
      if (hosted !== null) unmount(hosted);
    } else if (hosted === null) {
      const { host, root } = shadowHost(context.doc);
      found.item.append(host);
      render(
        <Message
          course={found.courseId}
          topic={found.topicId}
          onClose={() => setOpen(context, key, false)}
        />,
        root,
      );
    }
  }

  function onClick(event: MouseEvent): void {
    const target = event.target;
    if (current === null || !(target instanceof Element) || event.defaultPrevented) return;
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
      return;
    }
    const row = target.closest<HTMLElement>('[data-testid^="announcement-item-"]');
    const found = row === null ? null : findAnnouncementItem(row, current.origin);
    if (found === null || !(found.link.contains(target) || found.title?.contains(target))) return;
    // The widget would leave the page. React listens at its root, so this runs first.
    event.preventDefault();
    event.stopImmediatePropagation();
    const key = keyOf(found.courseId, found.topicId);
    setOpen(current, key, !open.has(key));
  }

  function CourseFilter(props: {
    id: string;
    courses: DashboardCourse[];
    onChange(id: string): void;
  }) {
    return (
      <>
        <label class="wr-filter-label" for={props.id}>
          {t('annCourseFilter')}
        </label>
        <select
          id={props.id}
          class="wr-filter-select"
          value={courseId}
          onChange={(event) => props.onChange(event.currentTarget.value)}
        >
          <option value="">{t('annAllCourses')}</option>
          {props.courses.map((course) => (
            <option key={course.id} value={course.id}>
              {course.name}
            </option>
          ))}
        </select>
      </>
    );
  }

  function Entry(props: { entry: AnnouncementEntry }) {
    const { entry } = props;
    const key = keyOf(entry.courseId, entry.id);
    const [on, setOn] = useState(open.has(key));
    const posted = entry.postedAt === null ? null : new Date(entry.postedAt);
    const meta = [
      entry.author === null ? null : t('annSentBy', entry.author),
      posted === null || Number.isNaN(posted.getTime())
        ? null
        : posted.toLocaleDateString(undefined, { dateStyle: 'medium' }),
    ].filter(Boolean);
    const show = (next: boolean): void => {
      if (next) open.add(key);
      else open.delete(key);
      setOn(next);
    };
    return (
      <div class="wr-item">
        <div class="wr-x-title">{entry.title}</div>
        <div class="wr-x-meta">{meta.join(' | ')}</div>
        {on ? (
          <Message course={entry.courseId} topic={entry.id} onClose={() => show(false)} />
        ) : (
          <button type="button" class="wr-x-link" onClick={() => show(true)}>
            {t('annReadMore')}
          </button>
        )}
      </div>
    );
  }

  function Entries(props: {
    entries: AnnouncementEntry[] | 'loading' | 'failed';
    filter: ReadFilter;
  }) {
    const { entries, filter } = props;
    if (!Array.isArray(entries)) {
      return (
        <p class="wr-x-note">{t(entries === 'failed' ? 'annListFailed' : 'annListLoading')}</p>
      );
    }
    const shown = entries.filter((entry) => {
      const key = keyOf(entry.courseId, entry.id);
      // An announcement the student has open stays in the list until they close it.
      return (
        filter === 'all' || (filter === 'read') === (read.has(key) || entry.read) || open.has(key)
      );
    });
    const empty = { unread: 'annEmptyUnread', read: 'annEmptyRead', all: 'annEmptyAll' } as const;
    return shown.length === 0 ? (
      <p class="wr-x-note">{t(empty[filter])}</p>
    ) : (
      <>
        {shown.map((entry) => (
          <Entry key={`${entry.courseId}:${entry.id}`} entry={entry} />
        ))}
      </>
    );
  }

  /** A host element of the fix inside the bar of the widget, made once. */
  function bayOf(widget: AnnouncementsWidget, name: string, make: () => HTMLElement): HTMLElement {
    let bay = widget.bar.querySelector<HTMLElement>(`:scope > [data-wr-${name}]`);
    if (bay === null) {
      bay = make();
      bay.setAttribute(OWN, 'ann');
      bay.setAttribute(`data-wr-${name}`, '');
    }
    return bay;
  }

  function drawFilter(
    context: FixContext,
    widget: AnnouncementsWidget,
    courses: DashboardCourse[],
  ): void {
    const field = bayOf(widget, 'filter', () => context.doc.createElement('div'));
    if (field.previousElementSibling !== widget.filterBlock) widget.filterBlock.after(field);
    render(
      <CourseFilter
        id="wr-course-filter"
        courses={courses}
        onChange={(id) => {
          courseId = id;
          context.again();
        }}
      />,
      field,
    );
  }

  function drawList(context: FixContext, widget: AnnouncementsWidget): void {
    const asked = courseId;
    const host = bayOf(widget, 'list', () => shadowHost(context.doc).host);
    if (host.parentElement !== widget.bar) widget.bar.append(host);
    if (!lists.has(asked)) {
      lists.set(asked, 'loading');
      context
        .send({ type: 'weekrow:announcement-list', courseId: asked })
        .then((reply) =>
          lists.set(asked, Array.isArray(reply) ? (reply as AnnouncementEntry[]) : 'failed'),
        )
        .catch(() => lists.set(asked, 'failed'))
        .finally(() => context.again());
    }
    render(
      <Entries entries={lists.get(asked) ?? 'loading'} filter={widget.read} />,
      host.shadowRoot?.lastElementChild as HTMLElement,
    );
  }

  return {
    apply(context) {
      current = context;
      if (stopClicks === null) {
        const win = context.doc.defaultView;
        win?.addEventListener('click', onClick, true);
        stopClicks = () => win?.removeEventListener('click', onClick, true);
      }
      for (const widget of findAnnouncementsWidgets(context.doc, context.origin)) {
        widget.widget.setAttribute('data-wr-ann', '');
        widget.bar.setAttribute('data-wr-bar', '');
        widget.content?.setAttribute('data-wr-content', '');
        for (const found of widget.items) {
          found.snippet?.setAttribute('data-wr-snippet', '');
          found.linkRow?.setAttribute('data-wr-more', '');
          found.title?.setAttribute('data-wr-title', '');
          expandNative(context, found);
          // A read announcement leaves the unread list when its message is closed.
          const key = keyOf(found.courseId, found.topicId);
          found.item.toggleAttribute(
            'data-wr-gone',
            widget.read === 'unread' && read.has(key) && !open.has(key),
          );
        }
        if (context.data !== null) drawFilter(context, widget, context.data.courses);
        widget.widget.toggleAttribute('data-wr-filtered', courseId !== '');
        const list = widget.bar.querySelector(':scope > [data-wr-list]');
        if (courseId === '' && list) unmount(list);
        if (courseId !== '') drawList(context, widget);
        // The hosts take the theme of the widget, which their shadow roots cannot see.
        const dark = isDarkWidget(widget.widget);
        widget.widget
          .querySelectorAll(MINE)
          .forEach((host) => host.toggleAttribute('data-wr-dark', dark));
      }
    },
    remove() {
      stopClicks?.();
      stopClicks = null;
      const doc = current?.doc;
      current = null;
      open.clear();
      courseId = '';
      doc?.querySelectorAll(MINE).forEach(unmount);
      for (const attribute of ATTRIBUTES) {
        doc?.querySelectorAll(`[${attribute}]`).forEach((node) => node.removeAttribute(attribute));
      }
    },
  };
}
