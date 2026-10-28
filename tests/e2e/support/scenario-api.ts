import type { Worker } from '@playwright/test';
import { customGradeStatusesAnswer } from '../../fixtures/graphql';
import { IDS, type Scenario } from '../../fixtures/scenario';
import type { FakeCanvasRoute, JsonValue } from './fake-canvas';

export function json(value: unknown): JsonValue {
  return value as JsonValue;
}

/**
 * The Canvas API for the scenario. The planner answers every row of the term: the extension
 * places items by their own dates and drops the rest, so the range does not change the view.
 */
export function apiRoutes(scenario: Scenario): FakeCanvasRoute[] {
  const courseIds = scenario.courses.map((course) => course.id);
  const created = {
    id: '99001',
    plannable_type: 'assignment',
    plannable_id: IDS.assignments.bioQuiz3Today,
    user_id: IDS.user,
    assignment_id: IDS.assignments.bioQuiz3Today,
    workflow_state: 'active',
    marked_complete: true,
    dismissed: false,
  };
  return [
    { path: '/api/v1/users/self', body: json(scenario.self) },
    { path: '/api/v1/users/self/profile', body: json(scenario.profile) },
    { path: '/api/v1/courses', body: json(scenario.courses) },
    { path: '/api/v1/users/self/groups', body: json(scenario.groups) },
    { path: '/api/v1/users/self/colors', body: json(scenario.colors) },
    { path: '/api/v1/users/self/dashboard_positions', body: json(scenario.dashboardPositions) },
    { path: '/api/v1/planner/items', body: json(scenario.plannerItems) },
    { path: '/api/v1/planner/overrides', body: json(scenario.plannerOverrides) },
    { method: 'POST', path: '/api/v1/planner/overrides', body: json(created) },
    ...courseIds.map((id): FakeCanvasRoute => ({
      path: new RegExp(`^/api/v1/courses/${id}/assignments\\?.*bucket=undated`),
      body: json(scenario.undatedAssignments[id] ?? []),
    })),
    ...courseIds.map((id): FakeCanvasRoute => ({
      path: `/api/v1/courses/${id}/assignments`,
      body: json(scenario.assignments[id] ?? []),
    })),
    {
      method: 'POST',
      path: '/api/graphql',
      respond: (request) => ({ body: json(customGradeStatusesAnswer(scenario, request.postData)) }),
    },
  ];
}

export interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

/** Saves the Canvas address as the setup flow does, from inside the extension. */
export async function saveAddress(worker: Worker, origin: string): Promise<void> {
  await worker.evaluate(async (value) => {
    const api = (globalThis as unknown as { chrome: { storage: { local: StorageArea } } }).chrome;
    await api.storage.local.set({ canvasOrigin: value });
  }, origin);
}

export async function savedAddress(worker: Worker): Promise<unknown> {
  return worker.evaluate(async () => {
    const api = (globalThis as unknown as { chrome: { storage: { local: StorageArea } } }).chrome;
    return (await api.storage.local.get('canvasOrigin'))['canvasOrigin'] ?? null;
  });
}
