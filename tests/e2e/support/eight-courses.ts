import { courseJson } from '../../fixtures/canvas-json';
import type { ScenarioOptions } from './weekrow';

/**
 * Two courses more than the scenario has, so eight in all. The Course grades widget of the widget
 * dashboard fixture shows six cards and a pager with two pages, which needs more than six courses.
 */
export const EIGHT_COURSES: ScenarioOptions = {
  extend(scenario) {
    for (const [id, name, code] of [
      ['107', 'PSYC 100: Intro to Psychology', 'PSYC 100'],
      ['108', 'ENGL 112: Academic Writing', 'ENGL 112'],
    ] as const) {
      const term = scenario.courses[0]?.term;
      scenario.courses.push({
        ...courseJson({
          id,
          name,
          courseCode: code,
          term: { id: '27', name: 'Fall 2026', startAt: null, endAt: null },
          totals: id === '107' ? { score: 95.7, grade: null } : 'hidden',
        }),
        ...(term === undefined ? {} : { term }),
      });
    }
  },
};
