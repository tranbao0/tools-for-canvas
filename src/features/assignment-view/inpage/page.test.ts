// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { ASSIGNMENT_DETAILS } from '../../../../tests/fixtures/assignment-view';
import { createAssignmentPage } from './page';

afterEach(() => document.body.replaceChildren());
const classic =
  '<div id="assignment_show"><div class="description"></div><ul class="student-assignment-overview"></ul></div>';
function start(body: string, reply: unknown) {
  document.body.innerHTML = body;
  const send = vi.fn(async () => reply);
  const engine = createAssignmentPage({
    doc: document,
    origin: 'https://canvas.test',
    courseId: '12',
    assignmentId: '2~101',
    send,
  });
  engine.setActive(true);
  return { engine, send };
}

it('accepts a global API id and removes the panel on stop', async () => {
  const details = structuredClone(ASSIGNMENT_DETAILS);
  details.assignment.id = '20000000000101';
  const { engine } = start('<main id="content">' + classic + '</main>', {
    details,
    timeZone: 'UTC',
  });
  await vi.waitFor(() =>
    expect(document.querySelector('#av-submission')?.shadowRoot?.textContent).toContain('5 / 10'),
  );
  engine.stop();
  expect(document.querySelector('#av-submission')).toBeNull();
});

it.each([
  '<main id="content"><div>' + classic + '</div></main>',
  '<main id="content">' +
    classic.replace('class="description"', 'class="description teacher-version"') +
    '</main>',
  '<a id="easy_student_view"></a><main id="content">' + classic + '</main>',
])('does not read details outside a classic student layout', (body) => {
  const { send } = start(body, undefined);
  expect(send).not.toHaveBeenCalled();
});

it('removes the observer panel but keeps other failures visible', async () => {
  start('<main id="content">' + classic + '</main>', { kind: 'no_submission_access' });
  await vi.waitFor(() => expect(document.querySelector('#av-submission')).toBeNull());
  start('<main id="content">' + classic + '</main>', undefined);
  await vi.waitFor(() =>
    expect(
      document.querySelector('#av-submission')?.shadowRoot?.querySelector('[role="alert"]'),
    ).not.toBeNull(),
  );
});
