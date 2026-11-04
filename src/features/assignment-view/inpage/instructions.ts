/**
 * The fold of the instructions: the text is cut to the height that its style sets, and "Show more"
 * shows the rest. The button shows only when text is cut.
 */

const BODY = '.av-instructions .av-body';

/** Cuts the instructions of a panel and shows the button only when text is cut. */
export function fitInstructions(panel: ParentNode | null | undefined): void {
  const body = panel?.querySelector<HTMLElement>(BODY);
  const more = panel?.querySelector<HTMLElement>('[data-action="more"]');
  if (!body || !more) return;
  if (more.getAttribute('aria-expanded') === 'true') return;
  body.setAttribute('data-av-clamped', '');
  const cut = body.scrollHeight > body.clientHeight + 1;
  body.toggleAttribute('data-av-cut', cut);
  more.hidden = !cut;
}

/** Shows or hides the rest of the instructions when the student presses the button. */
export function toggleInstructions(panel: ParentNode | null | undefined, button: Element): void {
  const body = panel?.querySelector(BODY);
  const open = button.getAttribute('aria-expanded') !== 'true';
  button.setAttribute('aria-expanded', String(open));
  button.textContent = open ? 'Show less' : 'Show more';
  if (open) {
    body?.removeAttribute('data-av-clamped');
    body?.removeAttribute('data-av-cut');
  } else {
    fitInstructions(panel);
  }
}
