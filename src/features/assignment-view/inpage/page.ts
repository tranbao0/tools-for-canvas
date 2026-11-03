import { isNoSubmissionAccess } from '../protocol';
import { normalizeCanvasId } from '../../../shared/canvas/ids';
import { PANEL_HOST_ATTRIBUTE } from '../../file-viewer/model';
import { isDetailsReply, renderError, renderLoading, renderPageDetails } from './details';
import { OWN, type RowsEngine, type RowsOptions } from './rows';
import { PANEL_CSS } from './styles';

/** Shows the signed-in student's details below the classic assignment description. */
export function createAssignmentPage(options: RowsOptions & { assignmentId: string }): RowsEngine {
  const { doc, origin, courseId, assignmentId, send } = options;
  let host: HTMLElement | null = null;
  let generation = 0;
  let stopped = false;
  async function load(): Promise<void> {
    const token = ++generation;
    const panel = host?.shadowRoot?.querySelector('.av-content-slot');
    if (!panel) return;
    panel.replaceChildren(renderLoading(doc));
    try {
      const reply = await send({ type: 'assignment:details', courseId, assignmentId });
      if (token !== generation) return;
      if (isNoSubmissionAccess(reply)) return clear();
      if (
        !isDetailsReply(reply) ||
        normalizeCanvasId(reply.details.assignment.id) !== normalizeCanvasId(assignmentId)
      )
        throw new Error('No assignment details');
      panel.replaceChildren(
        renderPageDetails(reply, {
          doc,
          origin,
          courseId,
          now: options.now ?? (() => Temporal.Now.instant()),
        }),
      );
    } catch {
      if (token === generation) panel.replaceChildren(renderError(doc));
    }
  }
  function clear(): void {
    ++generation;
    host?.remove();
    host = null;
  }
  return {
    setActive(active) {
      if (!active) return clear();
      if (stopped || host) return;
      if (doc.querySelector('#content > div:not([id]):only-child, #easy_student_view')) return;
      const description = doc.querySelector(
        '#content > #assignment_show:not(.teacher-version) > .description:not(.teacher-version)',
      );
      if (
        !description ||
        !doc.querySelector('#content > #assignment_show > .student-assignment-overview')
      )
        return;
      host = doc.createElement('div');
      host.setAttribute(OWN, '');
      host.setAttribute(PANEL_HOST_ATTRIBUTE, '');
      host.setAttribute('data-theme', options.theme?.() ?? 'light');
      host.id = 'av-submission';
      const shadow = host.attachShadow({ mode: 'open' });
      const style = doc.createElement('style');
      style.textContent =
        PANEL_CSS +
        '\n.av-content{max-width:none}\n.av{padding:20px 0;background:var(--av-card);margin-top:24px}.av-title{font-size:20px;margin:0 0 16px}';
      const panel = doc.createElement('section');
      panel.className = 'av';
      panel.setAttribute('aria-label', 'Your submission');
      const heading = doc.createElement('h2');
      heading.className = 'av-title';
      heading.textContent = 'Your submission';
      const slot = doc.createElement('div');
      slot.className = 'av-content-slot';
      panel.append(heading, slot);
      shadow.append(style, panel);
      shadow.addEventListener('click', (event) => {
        if (event.target instanceof Element && event.target.closest('[data-action="retry"]'))
          void load();
      });
      description.after(host);
      void load();
    },
    refreshTheme() {
      host?.setAttribute('data-theme', options.theme?.() ?? 'light');
    },
    reload: load,
    stop() {
      stopped = true;
      clear();
    },
  };
}
