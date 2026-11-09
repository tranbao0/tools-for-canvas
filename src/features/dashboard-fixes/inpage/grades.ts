/**
 * A grade card for every course (design decision 22).
 *
 * The Course grades widget pages its cards six at a time and shows a pager under them. This fix
 * adds a card for each course that has no card on the page, and hides the pager once the page has
 * a card for every page that the pager reaches. The cards are
 * copies of a card that the widget drew, so they look the same in every theme. The copy keeps its
 * layout and eye button, but has no course settings menu. A trusted eye click asks the background
 * to save the visibility and reloads the dashboard after confirmation to refresh React's state.
 * The color of the header is the one that the widget draws for the
 * course, the grade is the total that Canvas sends for the course, and `N/A` shows when
 * Canvas sends none (a course that hides its totals, or one with no score yet). While the
 * native main toggle is off, copies without an explicit visible preference show dots.
 */
import {
  findGradeWidgets,
  inEditMode,
  findPagedWidgets,
  type GradeCards,
} from '../../../shared/canvas/widgetDashboard';
import { t } from '../../../shared/ui/i18n';
import { paneInView } from '../../file-viewer/dock';
import type { DashboardCourse } from '../protocol';
import type { Fix, FixContext } from './context';

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const HIDDEN_GRADE = '•••';
const EYE =
  'M960 1489.82c-348.474 0-668.545-202.323-841.298-529.918C291.455 632.306 611.526 429.984 960 429.984s668.545 202.322 841.298 529.918C1628.545 1287.497 1308.474 1489.82 960 1489.82Zm948.342-553.552C1720.645 558.648 1357.332 324 960 324c-397.333 0-760.645 234.648-948.342 612.268L0 959.902l11.658 23.634c187.697 377.62 551.01 612.268 948.342 612.268 397.333 0 760.645-234.648 948.342-612.268L1920 959.902l-11.658-23.634ZM960 1171.869c-116.9 0-211.967-95.067-211.967-211.967 0-116.9 95.067-211.967 211.967-211.967 116.9 0 211.967 95.067 211.967 211.967 0 116.9-95.067 211.967-211.967 211.967m0-529.918c-175.297 0-317.951 142.654-317.951 317.951 0 175.297 142.654 317.95 317.951 317.95 175.297 0 317.951-142.653 317.951-317.95S1135.297 641.951 960 641.951';
const OFF =
  'M1591.462 544.364c129.295 100.893 238.985 236.548 316.774 392.233L1920 960.23l-11.658 23.634c-187.797 377.713-551.097 612.353-948.31 612.353-111.385 0-220.227-18.546-323.876-55.003l35.186-99.94c92.203 32.43 189.386 48.963 288.69 48.963 348.463 0 668.417-202.422 841.164-529.795-69.735-131.839-164.48-246.404-274.912-332.46ZM959.968 430.361c99.41 0 196.487 16.533 290.492 49.6 27.555 8.69 55.321 19.711 82.982 32.005l-189.704 189.705c-52.142-36.988-115.2-59.35-183.77-59.35-175.291 0-317.94 142.65-317.94 317.941 0 68.57 22.362 131.627 59.349 183.77l-212.703 212.596c-30.734-18.547-62.21-39.319-94.852-64.012-110.537-86.056-205.283-200.727-275.124-332.46C291.55 632.677 611.61 430.361 959.968 430.361Zm181.968 422.861c18.653 31.582 29.993 67.827 29.993 107.04 0 116.896-95.065 211.96-211.96 211.96-39.107 0-75.459-11.34-106.935-29.992l288.902-289.008Zm-181.968-104.92c39.213 0 75.458 11.446 107.04 29.992L778 1067.302c-18.546-31.582-29.992-67.827-29.992-107.04 0-116.79 95.064-211.96 211.96-211.96Zm0 529.9c175.397 0 317.94-142.543 317.94-317.94 0-68.463-22.361-131.627-59.242-183.663l573.67-573.671L1717.408 128l-304.905 304.905c-43.027-21.408-86.373-40.273-128.66-53.52-103.542-36.457-212.49-55.004-323.875-55.004-397.213 0-760.62 234.64-948.204 612.354L0 960.368l11.764 23.634c77.79 155.685 187.479 291.34 317.516 392.656 28.403 21.514 55.64 40.167 82.24 57.23l-283.814 283.814 74.928 74.928 573.67-573.67c52.037 36.88 115.095 59.243 183.664 59.243';
/** The cards on one page of the Course grades widget, which its pager counts in. */
const CARDS_PER_PAGE = 6;

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

/**
 * The classes of a card and of everything in it. A copy is a clone, so it keeps the classes that
 * the card had when it was cloned. React gives the nodes of the card other classes when the theme
 * changes, so a change of this value tells that the copies show the old theme.
 */
function looksOf(card: HTMLElement): string {
  return [card, ...card.querySelectorAll('*')].map((node) => node.getAttribute('class')).join('|');
}

export interface GradeVisibilityStore {
  userId?: string;
  observed: Map<string, Map<string, boolean>>;
}

/** Finds draft controls across the open roots used by dashboard cards. */
function hasOpenWork(root: Document | ShadowRoot): boolean {
  for (const node of root.querySelectorAll<HTMLElement>(
    'form.wr-form, [role="dialog"] textarea, [role="dialog"] [contenteditable="true"], input[type="search"]',
  )) {
    if (node.getClientRects().length && (!(node instanceof HTMLInputElement) || node.value !== ''))
      return true;
  }
  return [...root.querySelectorAll('*')].some(
    (node) => node.shadowRoot && hasOpenWork(node.shadowRoot),
  );
}

const SAVE_FAILED_NOTE = 'Could not save grade visibility. Try again.';

function openWorkNote(doc: Document): string | null {
  if (paneInView()) return 'Close the open pane first.';
  return hasOpenWork(doc) || inEditMode(doc) ? 'Close the open form first.' : null;
}

function showNote(card: HTMLElement, id: string, text: string): void {
  card.querySelector('[data-wr-grade-note]')?.remove();
  const note = card.ownerDocument.createElement('span');
  note.setAttribute('role', 'status');
  note.setAttribute('data-wr-grade-note', '');
  note.style.cssText = 'display:block;margin-top:8px';
  note.textContent = text;
  card.querySelector(`[data-testid="course-${id}-name"]`)?.parentElement?.append(note);
}

export function gradesFix(store: GradeVisibilityStore = { observed: new Map() }): Fix {
  let doc: Document | null = null;
  /** What each grid shows. It stays out of the page, where a script could read the grades. */
  const signatures = new WeakMap<Element, string>();
  const nativeStates = new WeakMap<Element, { hidden: boolean; values: Map<string, boolean> }>();
  const { observed } = store;
  let saving = false;
  let nativeChangedAt = -Infinity;
  let lifetime = 0;
  const notes = new Map<string, string>();
  let focusCourse: string | undefined;
  let noteTimer: ReturnType<typeof setTimeout> | undefined;

  function setSaving(value: boolean): void {
    saving = value;
    for (const card of doc?.querySelectorAll('[data-wr-card]') ?? []) {
      if (value) card.setAttribute('aria-busy', 'true');
      else card.removeAttribute('aria-busy');
      for (const eye of card.querySelectorAll('button')) eye.disabled = value;
    }
  }

  /**
   * A note that asks to close open work goes when that work is gone. A form in a shadow root and
   * a pane change nothing that the page observer sees, so the check comes back each second.
   */
  function dropSettledNotes(context: FixContext): void {
    const waiting = [...notes].filter(([, note]) => note !== SAVE_FAILED_NOTE);
    if (waiting.length === 0) return;
    if (openWorkNote(context.doc) !== null) {
      noteTimer ??= setTimeout(() => {
        noteTimer = undefined;
        context.again();
      }, 1000);
      return;
    }
    for (const [id] of waiting) {
      notes.delete(id);
      context.doc.querySelector(`[data-wr-card="${id}"] [data-wr-grade-note]`)?.remove();
    }
  }

  function blockWhileSaving(event: Event): void {
    const target = event.target;
    if (
      !(target instanceof Element) ||
      !doc ||
      !findGradeWidgets(doc).some(({ widget }) => widget.contains(target))
    )
      return;
    if (saving) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (event.isTrusted && !target.closest('[data-wr-card]')) nativeChangedAt = Date.now();
  }

  /** Sets the text of the element with `suffix`, and removes it when there is no text. */
  function fill(card: HTMLElement, id: string, suffix: string, text: string | null): void {
    const node = card.querySelector<HTMLElement>(`[data-testid="course-${id}-${suffix}"]`);
    if (node === null) return;
    if (text === null) node.parentElement?.remove();
    else if (node.textContent !== text) node.textContent = text;
  }

  /** A copy of the template card for another course. */
  function copyFor(
    template: HTMLElement,
    course: DashboardCourse,
    hidden: boolean,
    context: FixContext,
    widgetId: string,
  ): HTMLElement {
    const from = cardCourseId(template);
    const card = template.cloneNode(true) as HTMLElement;
    // The copy keeps no id or label that names another course.
    for (const node of [card, ...card.querySelectorAll<HTMLElement>('*')]) {
      node.removeAttribute('id');
      node.removeAttribute('aria-describedby');
      node.removeAttribute('aria-labelledby');
      const testId = node.getAttribute('data-testid');
      if (testId !== null) node.setAttribute('data-testid', testId.replaceAll(from, course.id));
    }
    const eye = card.querySelector<HTMLButtonElement>(
      'button[data-testid*="single-grade-button-"]',
    );
    for (const node of card.querySelectorAll('button')) if (node !== eye) node.remove();
    if (inEditMode(context.doc)) eye?.remove();
    else if (eye) {
      const label = `${hidden ? 'Show' : 'Hide'} grade for ${course.name}`;
      eye.setAttribute('aria-label', label);
      eye.setAttribute(
        'data-testid',
        `${hidden ? 'show' : 'hide'}-single-grade-button-${course.id}`,
      );
      for (const node of eye.querySelectorAll('span')) {
        if (node.childElementCount === 0 && node.textContent?.includes('grade for'))
          node.textContent = label;
      }
      eye.style.color = course.ink;
      eye.querySelector('path')?.setAttribute('d', hidden ? OFF : EYE);
      eye.addEventListener('click', async (event) => {
        if (!event.isTrusted || saving || !context.data?.userId) return;
        event.preventDefault();
        event.stopPropagation();
        const note = openWorkNote(context.doc);
        if (note) {
          notes.set(course.id, note);
          showNote(card, course.id, note);
          context.again();
          return;
        }
        const started = lifetime;
        /** Ends the save and draws the card again from what Canvas holds. */
        const finish = (): void => {
          setSaving(false);
          // Focus that moved into a form or a pane stays there.
          const active = context.doc.activeElement;
          if (active === null || active === context.doc.body || card.contains(active))
            focusCourse = course.id;
          context.refreshGrades();
          card.remove();
          context.again();
        };
        setSaving(true);
        notes.delete(course.id);
        card.querySelector('[data-wr-grade-note]')?.remove();
        // Showing waits for the saved preference; hiding conceals the text immediately.
        fill(card, course.id, 'grade', HIDDEN_GRADE);
        try {
          for (;;) {
            if (started !== lifetime) return;
            for (const found of findGradeWidgets(context.doc)) observeNative(found);
            const remaining = 3000 - (Date.now() - nativeChangedAt);
            if (remaining <= 0) break;
            await new Promise((resolve) => setTimeout(resolve, remaining));
          }
          if (started !== lifetime) return;
          const note = openWorkNote(context.doc);
          if (note) {
            notes.set(course.id, note);
            finish();
            return;
          }
          const reply = await context.send({
            type: 'weekrow:grade-visibility',
            widgetId,
            courseId: course.id,
            userId: context.data.userId,
            visible: hidden,
          });
          if (started !== lifetime) return;
          if ((reply as { ok?: boolean } | undefined)?.ok === true) {
            // A reload would end the work that opened during the send.
            if (openWorkNote(context.doc)) finish();
            else context.doc.defaultView?.location.reload();
            return;
          }
        } catch {
          /* The card carries the failure note below. */
        }
        if (started !== lifetime) return;
        notes.set(course.id, SAVE_FAILED_NOTE);
        finish();
      });
    }
    const note = notes.get(course.id);
    if (note) showNote(card, course.id, note);
    card.setAttribute('data-wr-own', 'card');
    card.setAttribute('data-wr-card', course.id);
    card.setAttribute('aria-label', course.name);
    fill(card, course.id, 'name', course.name);
    fill(card, course.id, 'code', course.code);
    fill(card, course.id, 'term', course.term);
    fill(card, course.id, 'last-updated', null);
    const grade = card.querySelector<HTMLElement>(`[data-testid="course-${course.id}-grade"]`);
    if (grade !== null) {
      if (grade.getAttribute('aria-hidden') === 'true' && grade.nextElementSibling !== eye)
        grade.nextElementSibling?.remove();
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

  /** Reads native state directly, including changes that still await the observer batch. */
  function observeNative(found: GradeCards): void {
    const widgetId = (found.widget.getAttribute('data-testid') ?? '').replace(/^widget-/, '');
    const native = found.cards.filter((card) => !card.hasAttribute('data-wr-card'));
    let overrides = observed.get(widgetId);
    if (!overrides) {
      overrides = new Map();
      observed.set(widgetId, overrides);
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
    if (
      previous &&
      (previous.hidden !== found.gradesHidden ||
        [...values].some(([id, visible]) => previous.values.get(id) !== visible))
    )
      nativeChangedAt = Date.now();
    nativeStates.set(found.widget, { hidden: found.gradesHidden, values });
  }

  function sync(context: FixContext, found: GradeCards): void {
    if (context.data === null) return;
    const courses = context.data.courses;
    const template = found.cards.find((card) => !card.hasAttribute('data-wr-card'));
    const native = found.cards.filter((card) => !card.hasAttribute('data-wr-card'));
    const shown = new Set(native.map(cardCourseId));
    const missing = template === undefined ? [] : courses.filter((course) => !shown.has(course.id));
    // Canvas's pager and the steady navigator give way only when the page shows a card for every
    // page that the pager of Canvas reaches. A grid that is short of cards keeps the pager.
    const pages = findPagedWidgets(context.doc).find(({ widget }) => widget === found.widget);
    const covered =
      pages === undefined || native.length + missing.length > (pages.total - 1) * CARDS_PER_PAGE;
    found.widget.toggleAttribute('data-wr-grades', covered);
    const widgetId = (found.widget.getAttribute('data-testid') ?? '').replace(/^widget-/, '');
    const visibility = context.data?.gradeVisibilities;
    observeNative(found);
    const overrides = observed.get(widgetId);
    if (saving) return;
    const hidden = (id: string): boolean =>
      visibility == null ||
      overrides?.get(id) === false ||
      !(
        visibility[widgetId]?.[id] ??
        (context.data?.showGrades?.[widgetId] !== false && !found.gradesHidden)
      );
    const signature = JSON.stringify([
      inEditMode(context.doc),
      template === undefined ? null : looksOf(template),
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
    const focused =
      focusCourse ??
      copies.find((copy) => copy.contains(context.doc.activeElement))?.getAttribute('data-wr-card');
    for (const copy of copies) copy.remove();
    signatures.set(found.grid, signature);
    if (template === undefined) return;
    for (const course of missing)
      found.grid.append(copyFor(template, course, hidden(course.id), context, widgetId));
    if (focused)
      found.grid
        .querySelector<HTMLButtonElement>(`[data-wr-card="${focused}"] button`)
        ?.focus({ preventScroll: true });
    focusCourse = undefined;
  }

  return {
    apply(context) {
      if (doc !== context.doc) {
        doc = context.doc;
        doc.addEventListener('click', blockWhileSaving, true);
        doc.addEventListener('change', blockWhileSaving, true);
      }
      if (!saving) dropSettledNotes(context);
      for (const found of findGradeWidgets(context.doc)) sync(context, found);
    },
    remove() {
      lifetime++;
      saving = false;
      clearTimeout(noteTimer);
      noteTimer = undefined;
      doc?.removeEventListener('click', blockWhileSaving, true);
      doc?.removeEventListener('change', blockWhileSaving, true);
      for (const node of doc?.querySelectorAll('[data-wr-card]') ?? []) node.remove();
      for (const node of doc?.querySelectorAll('[data-wr-grades]') ?? []) {
        node.removeAttribute('data-wr-grades');
      }
      doc = null;
    },
  };
}
