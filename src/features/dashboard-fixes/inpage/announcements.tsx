/**
 * Announcements in place (design decision 22).
 *
 * The widget cuts a title at 75 characters and the message at 120, and "Read more" leaves the
 * dashboard. This fix makes "Read more" and a click on the title open the whole message inside
 * the card, with "Show less". The message comes from the background as the HTML a teacher wrote.
 * It goes through the sanitizer (src/shared/ui/sanitize.ts) into the shadow root of a host element that the fix
 * adds to the item, so the page styles do not reach it and it cannot reach the page.
 *
 * Opening or closing a message changes no read state and sends no write. Only the read circle of
 * the widget, which the fix leaves alone, marks an announcement as read. The fix also adds a
 * course filter beside the read filter. The widget loads three announcements of all courses a page, so a
 * course filter cannot be applied to its list. With a course chosen, the fix hides that list and
 * its pager and shows the recent announcements of the course, which the background loads.
 */
import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
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
import { sanitizeHtml } from '../../../shared/ui/sanitize';
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
  'filtered',
  'dark',
].map((name) => `data-wr-${name}`);

export function announcementsFix(): Fix {
  /** The announcements the student opened, which stay open while React draws the item again. */
  const open = new Set<string>();
  const bodies = new Map<string, AnnouncementBody>();
  const lists = new Map<string, AnnouncementEntry[] | 'loading' | 'failed'>();
  let courseId = '';
  /** The announcement whose message should take the focus once it shows. */
  let focusOpened: string | null = null;
  /** The announcement whose "Read more" link should take the focus back once the message closes. */
  let focusClosed: string | null = null;
  let current: FixContext | null = null;
  let stopClicks: (() => void) | null = null;

  const keyOf = (course: string, topic: string): string => `${course}:${topic}`;

  /** The message of one announcement, with "Show less". */
  function Message(props: { course: string; topic: string; onClose(): void }) {
    const { course, topic } = props;
    const key = keyOf(course, topic);
    const context = current as FixContext;
    const [message, setMessage] = useState(bodies.get(key));
    const [failed, setFailed] = useState(false);
    const less = useRef<HTMLButtonElement>(null);
    // The sanitized nodes are made once for a message, so a new pass keeps the selection.
    const body = useMemo(() => {
      if (message === undefined) return null;
      const box = context.doc.createElement('div');
      box.className = 'wr-body';
      box.append(sanitizeHtml(message.message, { origin: context.origin, doc: context.doc }));
      return box;
    }, [message]);

    useEffect(() => {
      // The link that opened the message is gone, so the focus moves into the message.
      if (focusOpened === key) {
        focusOpened = null;
        less.current?.focus();
      }
    }, []);
    useEffect(() => {
      if (message !== undefined) return;
      context
        .send({ type: 'weekrow:announcement', courseId: course, topicId: topic })
        .then((reply) => {
          const loaded = reply as AnnouncementBody | undefined;
          if (typeof loaded?.message !== 'string') throw new Error('No message');
          bodies.set(key, loaded);
          setMessage(loaded);
        })
        .catch(() => setFailed(true));
    }, [key]);
    return (
      <>
        <div
          ref={(slot) => {
            if (slot !== null && body !== null && slot.firstChild !== body)
              slot.replaceChildren(body);
          }}
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
          ) : (
            ''
          )}
        </p>
        <button type="button" class="wr-x-link" ref={less} onClick={props.onClose}>
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
    if (on) {
      open.add(key);
      focusOpened = key;
    } else {
      open.delete(key);
      focusClosed = key;
    }
    context.again();
  }

  /** The message takes the type size and the line height of the snippet that it replaces. */
  function matchBodyType(host: HTMLElement, found: AnnouncementItem): void {
    let leaf: Element | null | undefined = found.snippet;
    while (leaf?.firstElementChild) leaf = leaf.firstElementChild;
    const style = leaf?.ownerDocument.defaultView?.getComputedStyle(leaf);
    if (style === undefined) return;
    host.style.setProperty('--wr-fs', style.fontSize);
    host.style.setProperty('--wr-lh', style.lineHeight);
  }

  /** Shows or removes the message of a native item, as the open set says. */
  function expandNative(context: FixContext, found: AnnouncementItem): void {
    const key = keyOf(found.courseId, found.topicId);
    const hosted = found.item.querySelector<HTMLElement>(`:scope > ${MINE}`);
    found.item.toggleAttribute('data-wr-open', open.has(key));
    if (!open.has(key)) {
      if (hosted !== null) unmount(hosted);
      if (focusClosed === key) {
        // The link has its place back, and the focus goes there.
        focusClosed = null;
        found.link.focus();
      }
    } else if (hosted === null) {
      const { host, root } = shadowHost(context.doc);
      matchBodyType(host, found);
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
    // Only a row in a widget that the last pass found: the fix does nothing where it cannot work.
    const row = target.closest<HTMLElement>('[data-wr-ann] [data-testid^="announcement-item-"]');
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
        <div class="wr-select">
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
          <span class="wr-caret" aria-hidden="true" />
        </div>
      </>
    );
  }

  function Entry(props: { entry: AnnouncementEntry }) {
    const { entry } = props;
    const key = keyOf(entry.courseId, entry.id);
    const [on, setOn] = useState(open.has(key));
    const more = useRef<HTMLButtonElement>(null);
    const refocus = useRef(false);
    useEffect(() => {
      // Closing the message gives the focus back to the button that opened it.
      if (!on && refocus.current) {
        refocus.current = false;
        more.current?.focus();
      }
    }, [on]);
    const posted = entry.postedAt === null ? null : new Date(entry.postedAt);
    const meta = [
      entry.author === null ? null : t('annSentBy', entry.author),
      posted === null || Number.isNaN(posted.getTime())
        ? null
        : posted.toLocaleDateString(undefined, { dateStyle: 'medium' }),
    ].filter(Boolean);
    const show = (next: boolean): void => {
      if (next) {
        open.add(key);
        focusOpened = key;
      } else {
        open.delete(key);
        refocus.current = true;
      }
      setOn(next);
    };
    return (
      <div class="wr-item">
        <div class="wr-x-title">{entry.title}</div>
        <div class="wr-x-meta">{meta.join(' | ')}</div>
        {on ? (
          <Message course={entry.courseId} topic={entry.id} onClose={() => show(false)} />
        ) : (
          <button type="button" class="wr-x-link" ref={more} onClick={() => show(true)}>
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
      return filter === 'all' || (filter === 'read') === entry.read || open.has(key);
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

  /**
   * Gives the course filter the look of the read filter next to it, from the computed style of
   * the read filter: its box, its type and its colors, in any theme. The widget's own select is
   * the reference, so a change of the package follows.
   */
  function matchNative(field: HTMLElement, widget: AnnouncementsWidget): void {
    const input = widget.filterBlock.querySelector('input');
    const label = widget.filterBlock.querySelector('label');
    const select = field.querySelector('select');
    const view = field.ownerDocument.defaultView;
    if (input === null || select === null || view === null) return;
    const native = view.getComputedStyle(input);
    for (const name of [
      'height',
      'font-family',
      'font-size',
      'font-weight',
      'line-height',
      'color',
      'background-color',
      'border-width',
      'border-style',
      'border-color',
      'border-radius',
      'padding-left',
      'padding-right',
    ]) {
      select.style.setProperty(name, native.getPropertyValue(name));
    }
    select.style.setProperty('--wr-option-ink', native.color);
    select.style.setProperty('--wr-option-background', native.backgroundColor);
    const text = field.querySelector('label');
    if (label !== null && text !== null) {
      const own = view.getComputedStyle(label);
      for (const name of ['font-family', 'font-size', 'font-weight', 'line-height', 'color']) {
        text.style.setProperty(name, own.getPropertyValue(name));
      }
    }
    // The arrow takes the color of the arrow that the widget draws, when it can be told.
    const arrow = input.nextElementSibling;
    const caret = field.querySelector<HTMLElement>('.wr-caret');
    if (arrow !== null && caret !== null) {
      const style = view.getComputedStyle(arrow);
      const bordered = style.getPropertyValue('border-right-width') !== '0px';
      caret.style.color = bordered ? style.getPropertyValue('border-right-color') : style.color;
    }
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
        id={`wr-course-filter-${widget.widget.getAttribute('data-testid') ?? ''}`}
        courses={courses}
        onChange={(id) => {
          courseId = id;
          context.again();
        }}
      />,
      field,
    );
    matchNative(field, widget);
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
        }
        if (context.data !== null) drawFilter(context, widget, context.data.courses);
        widget.widget.toggleAttribute('data-wr-filtered', courseId !== '');
        const list = widget.bar.querySelector(':scope > [data-wr-list]');
        if (courseId === '' && list) unmount(list);
        if (courseId !== '') drawList(context, widget);
        // The hosts take the theme of the widget, which their shadow roots cannot see.
        const dark = isDarkWidget(widget.widget);
        widget.widget.toggleAttribute('data-wr-dark', dark);
        widget.widget
          .querySelectorAll(MINE)
          .forEach((host) => host.toggleAttribute('data-wr-dark', dark));
      }
    },
    reload() {
      // A list that failed is asked for again. The others stay on screen.
      for (const [id, entries] of lists) if (entries === 'failed') lists.delete(id);
    },
    remove() {
      stopClicks?.();
      lists.clear();
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
