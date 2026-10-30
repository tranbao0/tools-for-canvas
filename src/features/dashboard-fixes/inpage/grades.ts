/**
 * A grade card for every course (design decision 22).
 *
 * The Course grades widget pages its cards six at a time and shows a pager under them. This fix
 * hides the pager and adds a card for each course that has no card on the page. The cards are
 * copies of a card that the widget drew, so they look the same in every theme. The copy keeps its
 * layout and loses its buttons, because they belong to React. The color of the header is the
 * course color, the grade is the total that Canvas sends for the course, and `N/A` shows when
 * Canvas sends none (a course that hides its totals, or one with no score yet). While the
 * widget's "Show all grades" toggle is off, the copies show dots, as the widget does.
 */
import { findGradeWidgets, type GradeCards } from '../../../shared/canvas/widgetDashboard';
import { t } from '../../../shared/ui/i18n';
import type { DashboardCourse } from '../protocol';
import type { Fix, FixContext } from './context';

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const HIDDEN_GRADE = '•••';

/** The grade a card shows: the letter, else the whole percent, else `N/A`. */
export function gradeText(course: Pick<DashboardCourse, 'score' | 'grade'>): string {
  if (course.grade !== null) return course.grade;
  if (course.score !== null) return `${Math.floor(course.score)}%`;
  return t('gradeNA');
}

/** The id of the course a native card shows, from its test id. */
function cardCourseId(card: HTMLElement): string {
  return (card.getAttribute('data-testid') ?? '').replace('course-grade-card-', '');
}

export function gradesFix(): Fix {
  let doc: Document | null = null;
  /** What each grid shows. It stays out of the page, where a script could read the grades. */
  const signatures = new WeakMap<Element, string>();
  const nativeStates = new WeakMap<Element, { hidden: boolean; values: Map<string, boolean> }>();
  let observed = new WeakMap<Element, Map<string, boolean>>();

  /** Sets the text of the element with `suffix`, and removes it when there is no text. */
  function fill(card: HTMLElement, id: string, suffix: string, text: string | null): void {
    const node = card.querySelector<HTMLElement>(`[data-testid="course-${id}-${suffix}"]`);
    if (node === null) return;
    if (text === null) node.parentElement?.remove();
    else node.textContent = text;
  }

  /** A copy of the template card for another course. */
  function copyFor(template: HTMLElement, course: DashboardCourse, hidden: boolean): HTMLElement {
    const from = cardCourseId(template);
    const card = template.cloneNode(true) as HTMLElement;
    // The copy keeps no id, no label that names another course and no button.
    for (const node of [card, ...card.querySelectorAll<HTMLElement>('*')]) {
      node.removeAttribute('id');
      node.removeAttribute('aria-describedby');
      node.removeAttribute('aria-labelledby');
      const testId = node.getAttribute('data-testid');
      if (testId !== null) node.setAttribute('data-testid', testId.replaceAll(from, course.id));
    }
    for (const node of card.querySelectorAll('button')) node.remove();
    card.setAttribute('data-wr-own', 'card');
    card.setAttribute('data-wr-card', course.id);
    card.setAttribute('aria-label', course.name);
    fill(card, course.id, 'name', course.name);
    fill(card, course.id, 'code', course.code);
    fill(card, course.id, 'term', course.term);
    fill(card, course.id, 'last-updated', null);
    const grade = card.querySelector<HTMLElement>(`[data-testid="course-${course.id}-grade"]`);
    if (grade !== null) {
      if (grade.getAttribute('aria-hidden') === 'true') grade.nextElementSibling?.remove();
      grade.textContent = hidden ? HIDDEN_GRADE : gradeText(course);
      grade.removeAttribute('aria-hidden');
      grade.removeAttribute('aria-label');
      if (hidden) {
        grade.setAttribute('aria-hidden', 'true');
        const label = grade.ownerDocument.createElement('span');
        label.textContent = `Grade hidden for ${course.name}`;
        label.style.cssText =
          'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)';
        grade.after(label);
      }
      if (HEX.test(course.color) && HEX.test(course.ink)) {
        const ink = course.ink;
        grade.style.color = ink;
        const pill = grade.parentElement;
        const overlay = pill?.parentElement;
        const header = overlay?.parentElement;
        if (pill) {
          pill.style.backgroundColor =
            ink === '#FFFFFF' ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.85)';
        }
        if (header) {
          // The copy has the color alone: no photo and no tint over it.
          header.style.backgroundImage = 'none';
          header.style.backgroundColor = course.color;
          for (const child of [...header.children]) {
            if (child !== overlay && child instanceof HTMLElement) child.remove();
          }
        }
      }
    }
    const fromName = template.getAttribute('aria-label') ?? '';
    for (const link of card.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      const grades = link.getAttribute('href')?.endsWith('/grades') === true;
      link.setAttribute('href', `/courses/${course.id}${grades ? '/grades' : ''}`);
      const label = link.getAttribute('aria-label');
      if (label !== null && fromName !== '') {
        link.setAttribute('aria-label', label.replaceAll(fromName, course.name));
      }
    }
    return card;
  }

  function sync(context: FixContext, found: GradeCards): void {
    if (context.data === null) return;
    const courses = context.data.courses;
    const template = found.cards.find((card) => !card.hasAttribute('data-wr-card'));
    const native = found.cards.filter((card) => !card.hasAttribute('data-wr-card'));
    const shown = new Set(native.map(cardCourseId));
    const missing = template === undefined ? [] : courses.filter((course) => !shown.has(course.id));
    found.widget.setAttribute('data-wr-grades', '');
    const widgetId = (found.widget.getAttribute('data-testid') ?? '').replace(/^widget-/, '');
    const visibility = context.data?.gradeVisibilities;
    let overrides = observed.get(found.widget);
    if (!overrides) {
      overrides = new Map(Object.entries(visibility?.[widgetId] ?? {}));
      observed.set(found.widget, overrides);
    }
    const previous = nativeStates.get(found.widget);
    const values = new Map<string, boolean>();
    for (const card of native) {
      const id = cardCourseId(card);
      const grade = card.querySelector(`[data-testid="course-${id}-grade"]`);
      if (grade) {
        const visible = grade.textContent !== HIDDEN_GRADE;
        values.set(id, visible);
        if (
          visible !== !found.gradesHidden ||
          (previous?.hidden === found.gradesHidden &&
            previous.values.has(id) &&
            previous.values.get(id) !== visible)
        ) {
          overrides.set(id, visible);
        }
      }
    }
    nativeStates.set(found.widget, { hidden: found.gradesHidden, values });
    const hidden = (id: string): boolean =>
      visibility == null || !(overrides?.get(id) ?? !found.gradesHidden);
    const signature = JSON.stringify([
      missing.map((course) => [course.id, course.name, course.color, course.score, course.grade]),
      missing.map((course) => hidden(course.id)),
    ]);
    const copies = found.cards.filter((card) => card.hasAttribute('data-wr-card'));
    const first = copies[0];
    // The copies stay while nothing changed. Their place is the end of the grid.
    if (
      template !== undefined &&
      first !== undefined &&
      signatures.get(found.grid) === signature &&
      copies.length === missing.length &&
      found.grid.lastElementChild === copies.at(-1)
    ) {
      return;
    }
    for (const copy of copies) copy.remove();
    signatures.set(found.grid, signature);
    if (template === undefined) return;
    for (const course of missing) found.grid.append(copyFor(template, course, hidden(course.id)));
  }

  return {
    apply(context) {
      doc = context.doc;
      for (const found of findGradeWidgets(context.doc)) sync(context, found);
    },
    reload() {
      observed = new WeakMap();
    },
    remove() {
      observed = new WeakMap();
      for (const node of doc?.querySelectorAll('[data-wr-card]') ?? []) node.remove();
      for (const node of doc?.querySelectorAll('[data-wr-grades]') ?? []) {
        node.removeAttribute('data-wr-grades');
      }
    },
  };
}
