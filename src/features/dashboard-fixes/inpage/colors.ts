/**
 * Course colors on the icons of the Course work widget (design decision 22).
 *
 * The widget colors an icon box by the status of the work. This fix colors it by the course, as
 * Canvas does for the planner and the dashboard cards: the course color as the background and
 * white or black text and icon, whichever the widget's own `getAccessibleTextColor` rule picks.
 * The status stays in the pill beside the title, which this fix does not touch.
 *
 * React rewrites the inline style of the icon, so the fix sets no inline style. It sets one
 * attribute with the course id on the box, and a rule of the fixes stylesheet reads the color.
 */
import { isCanvasId } from '../../../shared/canvas/ids';
import { findCourseWorkIcons } from '../../../shared/canvas/widgetDashboard';
import type { Fix, FixContext } from './context';

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const ATTRIBUTE = 'data-wr-cc';

export function courseColorsFix(): Fix {
  let doc: Document | null = null;
  let css: FixContext['css'] | null = null;
  return {
    apply(context: FixContext) {
      doc = context.doc;
      css = context.css;
      const colors = new Map(
        (context.data?.courses ?? [])
          .filter((c) => isCanvasId(c.id) && HEX.test(c.color) && HEX.test(c.ink))
          .map((c) => [c.id, c]),
      );
      context.css(
        'colors',
        [...colors.values()]
          .map(({ id, color, ink }) => `[${ATTRIBUTE}="${id}"]{--wr-cc:${color};--wr-cc-fg:${ink}}`)
          .join(''),
      );
      for (const { box, courseId } of findCourseWorkIcons(context.doc, context.origin)) {
        if (!colors.has(courseId)) {
          box.removeAttribute(ATTRIBUTE);
        } else if (box.getAttribute(ATTRIBUTE) !== courseId) {
          box.setAttribute(ATTRIBUTE, courseId);
        }
      }
    },
    remove() {
      css?.('colors', null);
      for (const box of doc?.querySelectorAll(`[${ATTRIBUTE}]`) ?? []) {
        box.removeAttribute(ATTRIBUTE);
      }
    },
  };
}
