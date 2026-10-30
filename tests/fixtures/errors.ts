/**
 * Canvas error responses with their status and body text.
 *
 * The extension reads the status of an error, the text "Rate Limit Exceeded" of a throttle, and
 * whether a 403 body is a JSON object. So a response holds no headers, and a JSON body holds the
 * message that names the case.
 *
 * Sources in canvas-lms at commit 1c9f0bb:
 * - `render_json_unauthorized` (lib/authentication_methods.rb);
 * - `RequestThrottle#rate_limit_exceeded` (app/middleware/request_throttle.rb);
 * - `PlannerOverridesController#create` with the `plannable_id` uniqueness validation;
 * - `AssignmentsApiController#get_assignments` for the `assignment_ids[]` checks.
 */

export interface CanvasErrorFixture {
  status: number;
  /** The raw body text. */
  body: string;
}

function jsonError(status: number, body: unknown): CanvasErrorFixture {
  return { status, body: JSON.stringify(body) };
}

export const CANVAS_ERRORS = {
  /** Any API call with no session. */
  signedOut: jsonError(401, { errors: [{ message: 'user authorization required' }] }),
  /**
   * A signed-in student under "Limited Access for Students": the planner and planner notes
   * answer 403 with JSON `status` `unauthorized`.
   */
  limitedAccess: jsonError(403, {
    status: 'unauthorized',
    errors: [{ message: 'user not authorized to perform that action' }],
  }),
  /** The throttle on self-hosted or older Canvas. */
  rateLimited403: { status: 403, body: '403 Forbidden (Rate Limit Exceeded)\n' },
  /** The throttle on Instructure-hosted Canvas. */
  rateLimited429: { status: 429, body: '429 Too Many Requests (Rate Limit Exceeded)\n' },
  /** A second `POST /api/v1/planner/overrides` for the same item. */
  overrideExists: jsonError(400, { errors: { plannable_id: [{ message: 'taken' }] } }),
  notFound: jsonError(404, { errors: [{ message: 'The specified resource does not exist.' }] }),
  serverError: jsonError(500, { errors: [{ message: 'An error occurred.' }] }),
  /** More than 100 `assignment_ids[]` in one request. Canvas puts two spaces before "Limit". */
  tooManyAssignmentIds: jsonError(400, {
    message: 'Request contains too many assignment_ids.  Limit 100',
  }),
} as const satisfies Record<string, CanvasErrorFixture>;

/**
 * Canvas rejects the whole assignments request when an id is not an assignment the student can
 * see, such as a `sub_assignment` id, or when `per_page` is smaller than the number of ids.
 */
export function invalidAssignmentIds(ids: readonly string[]): CanvasErrorFixture {
  return jsonError(400, { message: `Invalid assignment_ids: ${ids.join(',')}` });
}

/** Responses from a site that is not Canvas, for the setup check. */
export const NOT_CANVAS_RESPONSES = {
  /** A normal web page at `/api/v1/users/self`. */
  htmlPage: {
    status: 200,
    body: '<!DOCTYPE html><html><head><title>Northfield State University</title></head><body><h1>Page not found</h1></body></html>',
  },
  /** A school address that sends the browser to its sign-in service. */
  redirectToSignIn: { status: 302, body: '' },
} as const satisfies Record<string, CanvasErrorFixture>;

/** Canvas puts this prefix before some JSON bodies. The client removes it. */
export const WHILE_ONE_PREFIX = 'while(1);';
