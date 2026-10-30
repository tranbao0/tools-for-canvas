/**
 * Canvas page fixtures for the adapter tests, modeled on the canvas-lms layout
 * (`layouts/application.html.erb`), the dashboard views and `dashboard-sidebar`, and the
 * course home view. Only tests import this module.
 */

import { HIDE_NATIVE_TODO_STYLE_ID } from '../nativeTodo';

export interface PageFixture {
  /** Body classes as Canvas renders them. */
  bodyClass: string;
  /** The `#content` markup. */
  content: string;
  /** The `#right-side` markup that the server renders. */
  rightSide: string;
  /** The inline style of `#right-side-wrapper`, if any. */
  wrapperStyle?: string;
  /** Leaves out `#application.ic-app`, for a page that is not Canvas. */
  notCanvas?: boolean;
}

function layout(fixture: PageFixture): string {
  if (fixture.notCanvas === true) return fixture.content;
  const style = fixture.wrapperStyle === undefined ? '' : ` style="${fixture.wrapperStyle}"`;
  return `
    <div id="application" class="ic-app">
      <div id="wrapper" class="ic-Layout-wrapper">
        <div id="main" class="ic-Layout-columns">
          <div id="not_right_side" class="ic-app-main-content">
            <div id="content-wrapper" class="ic-Layout-contentWrapper">
              <div id="content" class="ic-Layout-contentMain" role="main">${fixture.content}</div>
            </div>
            <div id="right-side-wrapper" class="ic-app-main-content__secondary"${style}>
              <aside id="right-side">${fixture.rightSide}</aside>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

/** Replaces the body of the document with the fixture. */
export function loadPage(doc: Document, fixture: PageFixture): void {
  doc.body.className = fixture.bodyClass;
  doc.body.innerHTML = layout(fixture);
}

/** Simulates Canvas filling `#right-side` with the `/dashboard-sidebar` response. */
export function injectSidebar(doc: Document, html: string): void {
  const rightSide = doc.getElementById('right-side');
  if (rightSide === null) throw new Error('no #right-side');
  rightSide.innerHTML = html;
}

const RECENT_FEEDBACK = `
  <div class="events_list recent_feedback">
    <div class="h2 shared-space"><h2>Recent Feedback</h2></div>
    <ul class="right-side-list events"><li><small>Nothing for now</small></li></ul>
  </div>`;

const COMING_UP = `
  <div class="events_list coming_up">
    <div class="h2 shared-space"><h2>Coming Up</h2></div>
    <ul class="right-side-list events"><li><small>Nothing for the next week</small></li></ul>
  </div>`;

const TEACHER_TODO = `
  <h2 class="todo-list-header" tabindex="-1">To Do</h2>
  <ul class="right-side-list to-do-list"><li class="todo"><a class="item" href="/courses/9/gradebook">Grade Essay 1</a></li></ul>`;

const SIDEBAR_BUTTONS = `
  <div><a href="/grades" class="Button button-sidebar-wide">View Grades</a></div>`;

/** `/dashboard-sidebar` for a student: the React To Do container, then Recent Feedback. */
export const STUDENT_SIDEBAR = `
  <div class="Sidebar__TodoListContainer"><div data-testid="ToDoSidebar"><h2 class="todo-list-header">To Do</h2></div></div>
  ${RECENT_FEEDBACK}${SIDEBAR_BUTTONS}`;

/** `/dashboard-sidebar` for a user with a teacher, TA or designer role: the legacy teacher To Do. */
export const MIXED_ROLE_SIDEBAR = `${TEACHER_TODO}${COMING_UP}${RECENT_FEEDBACK}${SIDEBAR_BUTTONS}`;

/** The mixed-role sidebar when no work needs grading: only Coming Up, no To Do header. */
export const MIXED_ROLE_SIDEBAR_NOTHING_TO_GRADE = `${COMING_UP}${RECENT_FEEDBACK}${SIDEBAR_BUTTONS}`;

/** `/dashboard-sidebar` with `render_both_to_do_lists`: the student list and the teacher list. */
export const BOTH_LISTS_SIDEBAR = `
  <div class="Sidebar__TodoListContainer"></div>
  <h2 class="todo-list-header" tabindex="-1">Teacher To Do</h2>
  <ul class="right-side-list to-do-list"><li class="todo">Grade Essay 1</li></ul>
  ${COMING_UP}${RECENT_FEEDBACK}`;

/** Card View before the sidebar loads: the server renders only a placeholder. */
export const CARD_VIEW: PageFixture = {
  bodyClass: 'with-left-side with-right-side dashboard primary-nav-expanded',
  content: `
    <div id="dashboard" class="ic-dashboard-app">
      <div id="DashboardCard_Container"><div class="ic-DashboardCard"></div></div>
      <div id="dashboard-activity" style="display: none"></div>
    </div>`,
  rightSide: '<div class="placeholder"></div>',
};

/** Recent Activity before the sidebar loads. */
export const RECENT_ACTIVITY: PageFixture = {
  bodyClass: 'with-right-side dashboard primary-nav-expanded',
  content: `
    <div id="dashboard" class="ic-dashboard-app">
      <div id="DashboardCard_Container" style="display: none"></div>
      <div id="dashboard-activity" class="ic-Dashboard-Activity"><ul class="recent_activity"></ul></div>
    </div>`,
  rightSide: '<div class="placeholder"></div>',
};

/** List View: the planner. The server renders no right side, and Canvas hides the wrapper. */
export const LIST_VIEW: PageFixture = {
  bodyClass: 'dashboard dashboard-is-planner primary-nav-expanded',
  content: `
    <div id="dashboard" class="ic-dashboard-app">
      <div id="dashboard-planner-header" class="CanvasPlanner__HeaderContainer"></div>
      <div id="dashboard-planner" class="StudentPlanner__Container"></div>
    </div>`,
  rightSide: '',
  wrapperStyle: 'display: none;',
};

/** The widget dashboard: a React root in `#content`, and an empty right column that Canvas hides. */
export const WIDGET_DASHBOARD: PageFixture = {
  bodyClass: 'dashboard primary-nav-expanded',
  content: `
    <div data-testid="widget-dashboard">
      <div data-testid="widget-columns">
        <div data-testid="widget-column-1"><div data-testid="widget-container-course_work_combined"></div></div>
        <div data-testid="widget-column-2"></div>
      </div>
    </div>`,
  rightSide: '',
};

/** The K-5 dashboard: no right column at all. */
export const K5_DASHBOARD: PageFixture = {
  bodyClass: 'primary-nav-expanded',
  content:
    '<div id="dashboard" class="ic-dashboard-app"><div id="dashboard-app-container"></div></div>',
  rightSide: '',
};

/** A student's course home page: the right column holds the React To Do container. */
export const COURSE_HOME: PageFixture = {
  bodyClass: 'with-left-side course-menu-expanded with-right-side home context-course_5',
  content: '<div id="course_home_content"><div id="context_modules"></div></div>',
  rightSide: `
    <div id="course_show_secondary">
      <a class="btn button-sidebar-wide" href="/courses/5/analytics">View Course Stream</a>
      <div class="todo-list Sidebar__TodoListContainer"></div>
    </div>
    ${RECENT_FEEDBACK}`,
};

/** A course home page for a user whose enrollment in the course is not a student enrollment. */
export const COURSE_HOME_MIXED_ROLE: PageFixture = {
  ...COURSE_HOME,
  rightSide: `<div id="course_show_secondary">${TEACHER_TODO}</div>${COMING_UP}`,
};

/** A K-5 subject course home page: Canvas renders no right side. */
export const K5_COURSE_HOME: PageFixture = {
  bodyClass: 'context-course_5 primary-nav-expanded',
  content: '<div id="course-home-k5"><div id="k5-course-header"></div></div>',
  rightSide: '',
};

/** A course page other than the home page, with a right column. */
export const COURSE_ASSIGNMENTS: PageFixture = {
  bodyClass: 'with-left-side with-right-side assignments context-course_5',
  content: '<div id="assignment_index"></div>',
  rightSide: '<div class="assignments-right-side"></div>',
};

/** A web page that is not Canvas. */
export const NOT_CANVAS: PageFixture = {
  bodyClass: 'home',
  content: '<main><h1>School news</h1><div id="right-side">Ads</div></main>',
  rightSide: '',
  notCanvas: true,
};

/** Whether the style that hides the native To Do is on the page. */
export function nativeTodoHidden(doc: Document = document): boolean {
  return doc.getElementById(HIDE_NATIVE_TODO_STYLE_ID) !== null;
}
