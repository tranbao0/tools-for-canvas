/**
 * The dock of a pane: a card with a gap around it that can fill the window. The weekly list dock
 * is no card, so the rules of a card live here and only the panes carry them.
 */
import { retryPaneIdentity, watchPaneIdentity } from './paneIdentity';
import { CARD_GAP_PX, createDock, type Dock, type DockOptions } from './dock';

const CARD_CSS = `:host([data-card]){box-sizing:border-box;padding:${CARD_GAP_PX}px ${CARD_GAP_PX}px ${CARD_GAP_PX}px 0;pointer-events:none}
:host([data-card][data-full]){padding:${CARD_GAP_PX}px;pointer-events:auto}
:host([data-card]) section{position:relative;overflow:hidden;border:1px solid var(--line);border-radius:10px;box-shadow:0 2px 14px rgba(0,0,0,.2);pointer-events:auto}
:host([data-card][data-theme='dark']) section{box-shadow:0 2px 14px rgba(0,0,0,.55)}
:host([data-card]) .handle{z-index:1;top:${CARD_GAP_PX}px;height:calc(100% - ${2 * CARD_GAP_PX}px);pointer-events:auto}
:host([data-card][data-full]) .handle{display:none}
.identity-cover{position:absolute;inset:0;z-index:10;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;background:var(--bg);color:var(--text);text-align:center;font:16px/1.5 Lato,Arial,sans-serif}
.identity-cover[hidden]{display:none}
.identity-actions{display:flex;gap:12px}
.identity-cover button{font:inherit;color:var(--text);background:var(--bg);border:1px solid var(--btn-line);border-radius:4px;padding:8px 20px;cursor:pointer}
.identity-cover button:hover{background:var(--btn-hover)}
.identity-cover button:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
@media(max-width:875px){:host([data-card]){padding:0}:host([data-card]) section{border:0;border-left:1px solid var(--edge);border-radius:0;box-shadow:none}}
`;

/** Makes the dock of a pane, with the rules of a card. */
export function createCardDock(
  options: Omit<DockOptions, 'card' | 'css'> & {
    onClose(): void;
    identityToken?: string;
    onIdentityChange?(confirmed: boolean): void;
  },
): Dock {
  const dock = createDock({ ...options, card: true, css: CARD_CSS });
  const doc = dock.host.ownerDocument;
  const cover = doc.createElement('div');
  cover.className = 'identity-cover';
  const message = doc.createElement('p');
  message.setAttribute('role', 'status');
  message.textContent = "Canvas can't confirm your sign-in.";
  const button = doc.createElement('button');
  button.type = 'button';
  button.textContent = 'Close';
  button.addEventListener('click', (event) => {
    if (event.isTrusted) options.onClose();
  });
  const retry = doc.createElement('button');
  retry.type = 'button';
  retry.textContent = 'Retry';
  let retrying = false;
  retry.addEventListener('click', (event) => {
    if (!event.isTrusted || retrying) return;
    retrying = true;
    retry.setAttribute('aria-disabled', 'true');
    void retryPaneIdentity(options.identityToken).finally(() => {
      retrying = false;
      retry.removeAttribute('aria-disabled');
    });
  });
  const actions = doc.createElement('div');
  actions.className = 'identity-actions';
  actions.append(retry, button);
  cover.append(message, actions);
  dock.section.append(cover);
  let confirmed = false;
  const inert = new Map<HTMLElement, boolean>();
  const sync = () => {
    for (const child of inert.keys()) if (child.parentElement !== dock.section) inert.delete(child);
    for (const child of dock.section.children) {
      if (!(child instanceof HTMLElement) || child === cover || child.tagName === 'STYLE') continue;
      if (!confirmed) {
        if (!inert.has(child)) inert.set(child, child.inert);
        child.inert = true;
      } else if (inert.has(child)) {
        child.inert = inert.get(child)!;
        inert.delete(child);
      }
    }
  };
  const observer = new MutationObserver(sync);
  observer.observe(dock.section, { childList: true });
  let stop: (() => void) | undefined;
  const open = dock.open;
  dock.open = () => {
    open();
    stop ??= watchPaneIdentity((yes) => {
      const changed = confirmed !== yes;
      confirmed = yes;
      dock.host.setAttribute('data-identity', yes ? 'yes' : 'unknown');
      const restoreFocus = yes && cover.contains(dock.root.activeElement);
      cover.hidden = yes;
      if (!yes && doc.activeElement === dock.host && !cover.contains(dock.root.activeElement))
        retry.focus({ preventScroll: true });
      sync();
      if (restoreFocus) dock.section.focus({ preventScroll: true });
      if (changed) options.onIdentityChange?.(yes);
    }, options.identityToken);
  };
  const close = dock.close;
  dock.close = () => {
    stop?.();
    stop = undefined;
    observer.disconnect();
    close();
  };
  return dock;
}
