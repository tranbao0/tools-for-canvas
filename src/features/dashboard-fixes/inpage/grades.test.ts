// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { gradesFix, gradeText } from './grades';
import { COURSES, dashboardData, drawDashboard, fakeContext } from './testing/dashboard';

beforeEach(() => drawDashboard());

const cards = () => [...document.querySelectorAll('[data-testid^="course-grade-card-"]')];

describe('gradeText', () => {
  it('shows the letter, else the whole percent, else N/A', () => {
    expect(gradeText({ score: 84.4, grade: 'B' })).toBe('B');
    expect(gradeText({ score: 95.7, grade: null })).toBe('95%');
    expect(gradeText({ score: null, grade: null })).toBe('N/A');
  });
});

describe('gradesFix', () => {
  it('adds a card for each course that has none, in the style of the cards of the widget', () => {
    gradesFix().apply(fakeContext());
    expect(cards()).toHaveLength(7);
    const card = document.querySelector('[data-testid="course-grade-card-107"]');
    expect(card?.getAttribute('aria-label')).toBe('PSYC 100: Intro to Psychology');
    expect(document.querySelector('[data-testid="course-107-grade"]')?.textContent).toBe('95%');
    expect(document.querySelector('[data-testid="course-107-name"]')?.textContent).toBe(
      'PSYC 100: Intro to Psychology',
    );
    // The copy carries the class of the card that the widget drew.
    const native = document.querySelector('[data-testid="course-grade-card-103"]');
    expect(card?.className).toBe(native?.className);
    expect(card?.querySelectorAll('button')).toHaveLength(0);
    expect(card?.querySelector('[data-testid="course-107-last-updated"]')).toBeNull();
    expect(card?.querySelector('a[href="/courses/107/grades"]')?.getAttribute('aria-label')).toBe(
      'View PSYC 100: Intro to Psychology gradebook',
    );
    expect(card?.querySelector('a[href="/courses/107"]')).not.toBeNull();
    expect(card?.querySelector('[id]')).toBeNull();
    expect(document.querySelector('[data-wr-grades]')).not.toBeNull();
  });

  it('shows N/A where Canvas sends no total, and colors the header with the course color', () => {
    const fix = gradesFix();
    const courses = COURSES.slice(0, 6).concat({
      ...COURSES[6]!,
      score: null,
      grade: null,
      color: '#324A4D',
    });
    fix.apply(fakeContext(dashboardData([], courses)));
    const grade = document.querySelector<HTMLElement>('[data-testid="course-107-grade"]');
    expect(grade?.textContent).toBe('N/A');
    const header = grade?.parentElement?.parentElement?.parentElement;
    expect(header?.style.backgroundColor).toMatch(/^(#324a4d|rgb\(50, 74, 77\))$/i);
    expect(grade?.style.color).toMatch(/^(#ffffff|rgb\(255, 255, 255\))$/i);
  });

  it('shows dots while the toggle hides every grade, and the grade again after it', () => {
    const fix = gradesFix();
    const context = fakeContext();
    fix.apply(context);
    document
      .querySelector('[data-testid="hide-all-grades-checkbox"]')
      ?.setAttribute('data-testid', 'show-all-grades-checkbox');
    fix.apply(context);
    expect(document.querySelector('[data-testid="course-107-grade"]')?.textContent).toBe('•••');
    document
      .querySelector('[data-testid="show-all-grades-checkbox"]')
      ?.setAttribute('data-testid', 'hide-all-grades-checkbox');
    fix.apply(context);
    expect(document.querySelector('[data-testid="course-107-grade"]')?.textContent).toBe('95%');
  });

  it('keeps a saved per-course hidden grade hidden when the main toggle is on', () => {
    const context = fakeContext({
      ...dashboardData(),
      gradeVisibilities: { 'course-grades-widget': { '107': false } },
    });
    gradesFix().apply(context);
    expect(document.querySelector('[data-testid="course-107-grade"]')?.textContent).toBe('•••');
  });

  it('uses a saved visible override while the main toggle is off', () => {
    document
      .querySelector('[data-testid="hide-all-grades-checkbox"]')
      ?.setAttribute('data-testid', 'show-all-grades-checkbox');
    gradesFix().apply(
      fakeContext({
        ...dashboardData(),
        gradeVisibilities: { 'course-grades-widget': { '107': true } },
      }),
    );
    expect(document.querySelector('[data-testid="course-107-grade"]')?.textContent).toBe('95%');
  });

  it('keeps a course hidden after its native card leaves the page', () => {
    const fix = gradesFix();
    const context = fakeContext();
    document.querySelector('[data-testid="course-103-grade"]')!.textContent = '•••';
    fix.apply(context);
    document.querySelector('[data-testid="course-grade-card-103"]')!.remove();
    fix.apply(context);
    expect(document.querySelector('[data-testid="course-103-grade"]')?.textContent).toBe('•••');
  });

  it('keeps grades hidden when preferences cannot be read', () => {
    gradesFix().apply(fakeContext({ ...dashboardData(), gradeVisibilities: null }));
    expect(document.querySelector('[data-testid="course-107-grade"]')?.textContent).toBe('•••');
  });

  it('does not copy a card twice, and draws again after React drew the grid again', () => {
    const fix = gradesFix();
    const context = fakeContext();
    fix.apply(context);
    fix.apply(context);
    expect(cards()).toHaveLength(7);
    drawDashboard();
    expect(cards()).toHaveLength(6);
    fix.apply(context);
    expect(cards()).toHaveLength(7);
  });

  it('adds no card for a course that already has one, and none without a card to copy', () => {
    gradesFix().apply(fakeContext(dashboardData([], COURSES.slice(0, 6))));
    expect(cards()).toHaveLength(6);
    for (const card of cards()) card.remove();
    gradesFix().apply(fakeContext());
    expect(cards()).toHaveLength(0);
  });

  it('keeps no grade in an attribute of the page, also while grades are hidden', () => {
    const fix = gradesFix();
    fix.apply(fakeContext());
    for (const element of document.querySelectorAll('*')) {
      for (const name of element.getAttributeNames()) {
        expect(`${name}=${element.getAttribute(name)}`).not.toMatch(/95\.7|"score"/);
      }
    }
  });

  it('leaves only the grade overlay in the header of a copy, with no photo and no tint', () => {
    const header = document
      .querySelector('[data-testid="course-grade-card-103"] .fx-grade')
      ?.closest('.fx-card-head');
    const photo = document.createElement('div');
    const tint = document.createElement('div');
    header?.append(photo, tint);
    gradesFix().apply(fakeContext());
    const copy = document.querySelector('[data-testid="course-grade-card-107"] .fx-card-head');
    expect(copy?.children).toHaveLength(1);
  });

  it('removes its cards and the marks that hide the pager', () => {
    const fix = gradesFix();
    fix.apply(fakeContext());
    fix.remove();
    expect(cards()).toHaveLength(6);
    expect(
      document.querySelector('[data-wr-grades], [data-wr-card], [data-wr-signature]'),
    ).toBeNull();
  });
});
