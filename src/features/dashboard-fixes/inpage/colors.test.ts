// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { courseColorsFix } from './colors';
import { COURSES, dashboardData, drawDashboard, fakeContext } from './testing/dashboard';

beforeEach(() => drawDashboard());

describe('courseColorsFix', () => {
  it('tags the icon box of each item with its course and writes one rule for each course', () => {
    const fix = courseColorsFix();
    const context = fakeContext();
    fix.apply(context);
    const boxes = [...document.querySelectorAll('[data-wr-cc]')];
    expect(boxes.map((box) => box.getAttribute('data-wr-cc'))).toEqual([
      '101',
      '101',
      '102',
      '103',
      '104',
      '103',
    ]);
    expect(context.blocks.get('colors')).toContain(
      '[data-wr-cc="101"]{--wr-cc:#0B874B;--wr-cc-fg:#FFFFFF}',
    );
    expect(context.blocks.get('colors')).toContain(
      '[data-wr-cc="104"]{--wr-cc:#FFD500;--wr-cc-fg:#000000}',
    );
    // The icon box wraps the span of the icon, and the icon stays untouched.
    expect(boxes[0]?.querySelector('svg')?.getAttribute('data-testid')).toBe('quiz-icon');
  });

  it('is idempotent: a second pass changes nothing', () => {
    const fix = courseColorsFix();
    fix.apply(fakeContext());
    const before = document.body.innerHTML;
    fix.apply(fakeContext());
    expect(document.body.innerHTML).toBe(before);
  });

  it('leaves an item of an unknown course alone, and refuses a color or id that is not safe', () => {
    const fix = courseColorsFix();
    const bad = COURSES.map((course) =>
      course.id === '101'
        ? { ...course, color: 'red;} body{display:none' }
        : course.id === '102'
          ? { ...course, id: '102"] x{color:red}[y="' }
          : course,
    );
    const context = fakeContext(dashboardData([], bad));
    fix.apply(context);
    expect(document.querySelectorAll('[data-wr-cc="101"]')).toHaveLength(0);
    expect(context.blocks.get('colors')).not.toContain('display:none');
    expect(context.blocks.get('colors')).not.toContain('color:red');
  });

  it('colors nothing before the data arrives', () => {
    courseColorsFix().apply(fakeContext(null));
    expect(document.querySelectorAll('[data-wr-cc]')).toHaveLength(0);
  });

  it('tags the items that React draws later, and remove undoes every tag', () => {
    const fix = courseColorsFix();
    const context = fakeContext();
    fix.apply(context);
    drawDashboard();
    expect(document.querySelectorAll('[data-wr-cc]')).toHaveLength(0);
    fix.apply(context);
    expect(document.querySelectorAll('[data-wr-cc]')).toHaveLength(6);
    fix.remove();
    expect(document.querySelectorAll('[data-wr-cc]')).toHaveLength(0);
  });
});
