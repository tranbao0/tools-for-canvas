import {
  assignmentJson,
  assignmentPlannerItem,
  type AssignmentSpec,
  type FixtureContext,
} from '../../fixtures/canvas-json';
import { IDS, type Scenario } from '../../fixtures/scenario';
import { compareInstants, isBefore, localDays } from '../../fixtures/time';

/** The courses of the fall term that get extra work. */
const TERM_COURSES = [
  IDS.courses.biology,
  IDS.courses.calculus,
  IDS.courses.history,
  IDS.courses.chemistry,
] as const;

/** The fall term of the scenario runs from 64 days before today to 53 days after it. */
const TERM_FIRST_DAY = -64;
const TERM_LAST_DAY = 53;

/** Ids of the extra assignments start here, far from every id of the scenario. */
const FIRST_ID = 600_001;

/**
 * Adds a full term of everyday work to the scenario, as a student with a busy schedule has:
 * six assignments a week in each fall course, due at 11:59 pm. Work due before `now` is handed
 * in and graded. The planner then holds several pages of items for the weeks of one view.
 * Returns the number of added assignments.
 */
export function addTermLoad(scenario: Scenario): number {
  const days = localDays(scenario.now, scenario.timeZone);
  const ctx: FixtureContext = {
    origin: scenario.origin,
    now: scenario.now,
    timeZone: scenario.timeZone,
    userId: IDS.user,
    userName: scenario.self.name,
  };
  const contextNames = new Map(
    scenario.plannerItems.flatMap((item) =>
      item.course_id !== undefined && item.context_name !== undefined
        ? [[item.course_id, item.context_name] as const]
        : [],
    ),
  );
  let nextId = FIRST_ID;
  let added = 0;
  for (let day = TERM_FIRST_DAY; day <= TERM_LAST_DAY; day += 1) {
    TERM_COURSES.forEach((courseId, index) => {
      // Each course has one free day a week, on a different day for each course.
      if ((((day - index) % 7) + 7) % 7 === 0) return;
      const id = String(nextId++);
      const due = days.at(day, '23:59:59');
      const done = isBefore(due, scenario.now);
      const spec: AssignmentSpec = {
        id,
        courseId,
        name: `Daily practice ${id}`,
        due,
        submissionTypes: ['online_text_entry'],
        submission: done
          ? {
              submittedAt: days.at(day, '20:00:00'),
              score: 5,
              grade: '5',
              graderId: IDS.teacher,
            }
          : {},
      };
      const course = { id: courseId, contextName: contextNames.get(courseId) ?? courseId };
      scenario.plannerItems.push(assignmentPlannerItem(ctx, course, spec));
      const list = scenario.assignments[courseId] ?? [];
      list.push(assignmentJson(ctx, spec, `8${id}`));
      scenario.assignments[courseId] = list;
      added += 1;
    });
  }
  scenario.plannerItems.sort((a, b) => compareInstants(a.plannable_date, b.plannable_date));
  return added;
}
