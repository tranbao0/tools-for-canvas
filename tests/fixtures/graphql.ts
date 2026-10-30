/**
 * The fake Canvas answer to the teacher status query of `src/shared/canvas/graphql.ts`.
 * The query has one alias per course (`c0`, `c1`, ...) and a variable of the same name that
 * holds the course id. The answer is built from those variables, so it does not depend on the
 * order of the courses.
 */
import type { Scenario } from './scenario';
import type { WireGraphqlCustomGradeStatusesBody } from './wire-types';

/** Reads the alias to course id map from the variables of a GraphQL request body. */
export function graphqlCourseIds(postData: string | null): Record<string, string> {
  const body: unknown = JSON.parse(postData ?? 'null');
  const variables =
    typeof body === 'object' && body !== null && 'variables' in body ? body.variables : null;
  if (typeof variables !== 'object' || variables === null) {
    throw new TypeError('The GraphQL request has no variables');
  }
  return Object.fromEntries(Object.entries(variables).map(([alias, id]) => [alias, String(id)]));
}

/**
 * The answer to a teacher status request: for each alias, the statuses of the course that the
 * alias's variable names. A course in the scenario without statuses has an empty list. A course
 * that is not in the scenario is null, as Canvas answers for a course it does not find.
 */
export function customGradeStatusesAnswer(
  scenario: Scenario,
  postData: string | null,
): WireGraphqlCustomGradeStatusesBody {
  const data: WireGraphqlCustomGradeStatusesBody['data'] = {};
  for (const [alias, courseId] of Object.entries(graphqlCourseIds(postData))) {
    const known = scenario.courses.some((course) => course.id === courseId);
    data[alias] = known
      ? {
          customGradeStatusesConnection: {
            nodes: (scenario.customGradeStatuses[courseId] ?? []).map((status) => ({
              _id: status.id,
              name: status.name,
            })),
          },
        }
      : null;
  }
  return { data };
}
