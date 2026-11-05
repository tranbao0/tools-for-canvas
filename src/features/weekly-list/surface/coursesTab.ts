/**
 * The weekly card on the Courses tab of the new widget dashboard (design decision 4). The Courses
 * tab shows no weekly card and no floating panel. The card stays on the page with its state, only
 * hidden, so the Dashboard tab shows it again with its open groups and its scroll positions.
 */
import { COURSES_TAB_ID, findSelectedDashboardTab } from '../../../shared/canvas/widgetDashboard';
import { createScrollKeeper } from './scrollKeeper';

/**
 * Hides the container while the Courses tab is selected, and shows it again on any other tab. The
 * layout code of the card sets the `style` attribute of the container and never the `hidden`
 * attribute, so the two do not undo each other. Returns the function that shows the container
 * again and stops watching.
 */
export function hideOnCoursesTab(doc: Document, container: HTMLElement): () => void {
  const keeper = createScrollKeeper(container);
  let hidden = false;
  const check = (): void => {
    const courses = findSelectedDashboardTab(doc) === COURSES_TAB_ID;
    if (courses === hidden) return;
    hidden = courses;
    container.hidden = courses;
    keeper.track();
    if (!courses) keeper.restore();
  };
  // The scroll offsets of the list are recorded for as long as it shows.
  keeper.track();
  // A change of the selected tab is one attribute, and a page that loads on the Courses tab draws
  // the tabs late, so the observer also sees nodes arrive.
  const observer = new MutationObserver(check);
  observer.observe(doc.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-selected'],
  });
  check();
  return () => {
    observer.disconnect();
    keeper.stop();
    container.hidden = false;
  };
}
