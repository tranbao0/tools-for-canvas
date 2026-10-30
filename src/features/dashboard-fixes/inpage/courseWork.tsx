/**
 * Course work extras (design decision 22): the "Also due" section under the Course work list.
 *
 * The widget lists assignment submissions only, and every filter leaves out work with no due
 * date. Overdue work shows only under Missing, and pages, ungraded discussions and the student's
 * own tasks never show. The section adds them, from the planner data that the weekly list already
 * holds, so it makes no request. The summary cards stay as Canvas draws them. The Due card counts
 * from today to 90 days, and Missing and Submitted count every date, so the cards can differ from
 * the list. The section says so in one line, because React draws the cards and the planner data
 * covers two weeks, so the extension cannot recompute the cards for the same range.
 */
import { render } from 'preact';
import {
  findCourseWorkWidgets,
  isDarkWidget,
  type CourseWorkWidget,
} from '../../../shared/canvas/widgetDashboard';
import { t, type MessageKey } from '../../../shared/ui/i18n';
import type { DashboardCourse, ExtraGroup, ExtraItem, ExtraType } from '../protocol';
import type { Fix, FixContext } from './context';

const COMPACT = 4;
const EXPANDED = 20;
const ALL_COURSES = 'all courses';

/** Group order of the compact list. */
const GROUP_ORDER: Record<ExtraGroup, number> = { undated: 0, overdue: 1, todo: 2 };

const TYPE_LABELS: Record<ExtraType, MessageKey> = {
  assignment: 'alsoDueTypeAssignment',
  quiz: 'alsoDueTypeQuiz',
  discussion: 'alsoDueTypeDiscussion',
  page: 'alsoDueTypePage',
  note: 'alsoDueTypeNote',
  other: 'alsoDueTypeOther',
};

function dueTime(item: ExtraItem): number {
  return item.due === null ? Number.POSITIVE_INFINITY : Date.parse(item.due);
}

/** Work that the widget's course filter lets through. An unknown label means every course. */
export function visibleExtras(
  extras: readonly ExtraItem[],
  courses: readonly DashboardCourse[],
  widget: Pick<CourseWorkWidget, 'status' | 'courseLabel'>,
): ExtraItem[] {
  const label = widget.courseLabel.trim();
  const course =
    label.toLowerCase() === ALL_COURSES ? undefined : courses.find((entry) => entry.name === label);
  return extras.filter(
    (item) =>
      (course === undefined || item.courseId === course.id) &&
      // Overdue work is already under Missing.
      !(widget.status === 'missing' && item.group === 'overdue'),
  );
}

/** The rows of the compact list: the groups in order, the work of each group by due date. */
export function compactOrder(items: readonly ExtraItem[]): ExtraItem[] {
  return [...items]
    .sort((a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group] || dueTime(a) - dueTime(b))
    .slice(0, COMPACT);
}

/** The rows of the long list: up to 20, by due date, with the work that has no date last. */
export function longOrder(items: readonly ExtraItem[]): ExtraItem[] {
  return [...items].sort((a, b) => dueTime(a) - dueTime(b)).slice(0, EXPANDED);
}

function dueLabel(item: ExtraItem): string {
  if (item.due === null) return t('alsoDueNoDate');
  const text = new Date(item.due).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  return item.group === 'overdue' ? `${t('alsoDueOverdue')} ${text}` : text;
}

interface SectionProps {
  items: ExtraItem[];
  /** Every extra that the widget filters let through, for the numbers of the note. */
  all: ExtraItem[];
  total: number;
  courses: DashboardCourse[];
  origin: string;
  note: boolean;
  expanded: boolean;
  /** A copy of an icon that the widget drew. */
  icon: Element | null;
  onToggle(): void;
}

function Row(props: { item: ExtraItem; course: DashboardCourse | undefined } & SectionProps) {
  const { item, course, origin } = props;
  const title = <span class="wr-x-title">{item.title}</span>;
  return (
    <li class="wr-x-row">
      <span
        class="wr-x-icon"
        style={{ backgroundColor: course?.color ?? '#626E7B', color: course?.ink ?? '#fff' }}
        ref={(box) => box?.replaceChildren(...(props.icon ? [props.icon.cloneNode(true)] : []))}
      />
      <div class="wr-x-main">
        {item.url?.startsWith(`${origin}/`) ? (
          <a class="wr-x-title" href={item.url}>
            {item.title}
          </a>
        ) : (
          title
        )}
        <div class="wr-x-meta">
          {[course?.name, t(TYPE_LABELS[item.type])].filter(Boolean).join(' | ')}
        </div>
      </div>
      <span class={`wr-x-pill wr-x-${item.group}`}>{dueLabel(item)}</span>
    </li>
  );
}

function Section(props: SectionProps) {
  return (
    <>
      <h3>{t('alsoDue')}</h3>
      {props.note && (
        <p class="wr-x-note">
          {t(
            'alsoDueNote',
            String(props.all.filter((item) => item.group === 'undated').length),
            String(props.all.filter((item) => item.group === 'overdue').length),
            String(props.all.filter((item) => item.group === 'todo').length),
          )}
        </p>
      )}
      <ul aria-label={props.expanded ? t('alsoDueAria') : t('alsoDue')}>
        {props.items.map((item) => (
          <Row
            key={item.key}
            {...props}
            item={item}
            course={props.courses.find((entry) => entry.id === item.courseId)}
          />
        ))}
      </ul>
      {props.total > COMPACT && (
        <button
          type="button"
          class="wr-x-link"
          aria-expanded={props.expanded}
          onClick={props.onToggle}
        >
          {t(props.expanded ? 'alsoDueShowFewer' : 'alsoDueShowAll')}
        </button>
      )}
    </>
  );
}

export function courseWorkFix(): Fix {
  let expanded = false;
  let doc: Document | null = null;

  function draw(context: FixContext, widget: CourseWorkWidget): void {
    const { data } = context;
    const items = data === null ? [] : visibleExtras(data.extras, data.courses, widget);
    let section = widget.widget.querySelector<HTMLElement>('[data-wr-extra]');
    if (items.length === 0 || data === null) {
      if (section !== null) render(null, section);
      section?.remove();
      return;
    }
    if (section === null) {
      section = context.doc.createElement('section');
      section.className = 'wr-x';
      section.setAttribute('data-wr-own', 'extra');
      section.setAttribute('data-wr-extra', '');
    }
    if (widget.after.nextElementSibling !== section) widget.after.after(section);
    section.toggleAttribute('data-wr-dark', isDarkWidget(widget.widget));
    render(
      <Section
        items={expanded ? longOrder(items) : compactOrder(items)}
        all={items}
        total={items.length}
        courses={data.courses}
        origin={context.origin}
        note={widget.hasStatistics}
        expanded={expanded}
        icon={context.doc.querySelector(
          '[data-testid="assignment-icon"], [data-testid="document-icon"]',
        )}
        onToggle={() => {
          expanded = !expanded;
          context.again();
        }}
      />,
      section,
    );
  }

  return {
    apply(context) {
      doc = context.doc;
      for (const widget of findCourseWorkWidgets(context.doc)) draw(context, widget);
    },
    remove() {
      for (const section of doc?.querySelectorAll<HTMLElement>('[data-wr-extra]') ?? []) {
        render(null, section);
        section.remove();
      }
      expanded = false;
    },
  };
}
