/**
 * The parts that the panes of the assignment view share: the header rules, the icons and the Full
 * view button. The panes sit in a card dock (decision 25), which gives the frame and the colors.
 */
import { fullViewAvailable, isFullView, setFullView, watchFullView } from '../../file-viewer/dock';
import {
  EXIT_FULL_VIEW_PATH,
  EXTERNAL_LINK_PATH,
  FULL_VIEW_PATH,
} from '../../../shared/ui/iconPaths';
import { t } from '../../../shared/ui/i18n';

/** The width of the content of the header below which the text buttons show their icon only. */
const COMPACT_HEADER_PX = 560;

/**
 * The header of a card pane: a title with an optional second line, then the buttons. The padding
 * is 16 px above, 16 px right, 14 px below and 32 px left. A header with one line is as high as its
 * buttons, and the title sits in the middle. The header is a container: when its content is
 * narrower than `COMPACT_HEADER_PX`, the text buttons show their icon only, so the title keeps its
 * room. The text stays in the accessible name and in the tooltip of each button.
 */
export const PANE_CSS = `
.bar{box-sizing:border-box;container-type:inline-size;display:flex;flex:none;align-items:flex-start;gap:10px;padding:16px 16px 14px 32px;border-bottom:1px solid var(--line);color:var(--text);line-height:20px}
.ti{display:flex;flex:1;flex-direction:column;justify-content:center;min-width:0;min-height:30px}
.title{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:18px;font-weight:700;line-height:1.25}
.sub{margin-top:3px;color:var(--muted);font-size:13px;line-height:1.3}
.sub[hidden],.btn[hidden]{display:none}
.btn{box-sizing:border-box;display:inline-flex;flex:none;align-items:center;gap:6px;height:30px;padding:0 10px;border:1px solid var(--edge);border-radius:4px;background:var(--bg);color:var(--text);font:inherit;font-size:13px;line-height:1.125;text-decoration:none;white-space:nowrap;cursor:pointer}
.btn:hover{background:var(--btn-hover);text-decoration:none}
@container (max-width:${COMPACT_HEADER_PX - 1}px){.btn{justify-content:center;width:30px;padding:0}.lb{display:none}}
.icon-btn{box-sizing:border-box;display:inline-flex;flex:none;align-items:center;justify-content:center;width:30px;height:30px;margin:0;padding:0;border:0;border-radius:4px;background:transparent;color:var(--text);cursor:pointer}
.icon-btn:hover{background:var(--hover)}
a:focus-visible,button:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
svg{display:block;flex:none;width:16px;height:16px}
`;

const SVG = 'http://www.w3.org/2000/svg';

/** The text of a header button: it hides when the header is compact (see `PANE_CSS`). */
function label(doc: Document, text: string): HTMLSpanElement {
  const span = doc.createElement('span');
  span.className = 'lb';
  span.textContent = text;
  return span;
}

/**
 * The "Open in new tab" link of a pane header. The caller sets `href`. The name and the tooltip
 * stay when the header shows the icon only.
 */
export function createOpenInTabLink(doc: Document): HTMLAnchorElement {
  const text = 'Open in new tab';
  const link = doc.createElement('a');
  link.className = 'btn';
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.setAttribute('aria-label', text);
  link.title = text;
  link.append(label(doc, text), icon(doc, EXTERNAL_LINK_PATH));
  return link;
}

export function icon(doc: Document, path: string): SVGElement {
  const svg = doc.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('fill-rule', 'evenodd');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const shape = doc.createElementNS(SVG, 'path');
  shape.setAttribute('d', path);
  svg.append(shape);
  return svg;
}

/** The title block of the header: the title and a second line, which stays hidden until a pane fills it. */
export interface HeaderText {
  block: HTMLElement;
  title: HTMLElement;
  sub: HTMLElement;
}

export function headerText(doc: Document): HeaderText {
  const block = doc.createElement('div');
  block.className = 'ti';
  const title = doc.createElement('span');
  title.className = 'title';
  const sub = doc.createElement('span');
  sub.className = 'sub';
  sub.hidden = true;
  block.append(title, sub);
  return { block, title, sub };
}

/** Shows the second line of the header, or hides it when there is no text. */
export function setSubtitle(sub: HTMLElement, text: string | undefined): void {
  sub.textContent = text ?? '';
  sub.hidden = text === undefined || text === '';
}

export interface FullViewControl {
  readonly button: HTMLButtonElement;
  /** Reads the state again, for a pane that just opened. */
  update(): void;
  /** Stops following the state. */
  stop(): void;
}

/**
 * The Full view button of a pane header. It is one element for the whole life of the pane: a
 * toggle changes its text, its icon and `aria-pressed` and never rebuilds it, so the focus stays
 * on it. It follows the shared full view state and the window width, and it hides on a window that
 * is too narrow for full view.
 */
export function createFullViewButton(doc: Document): FullViewControl {
  const win = doc.defaultView ?? window;
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'btn';
  const mark = icon(doc, FULL_VIEW_PATH);
  const path = mark.firstElementChild;
  const caption = label(doc, '');
  button.append(mark, caption);
  const update = (): void => {
    const on = isFullView();
    const text = t(on ? 'exitFullView' : 'fullView');
    caption.textContent = text;
    button.setAttribute('aria-label', text);
    button.title = text;
    button.setAttribute('aria-pressed', String(on));
    path?.setAttribute('d', on ? EXIT_FULL_VIEW_PATH : FULL_VIEW_PATH);
    button.hidden = !fullViewAvailable(win);
  };
  button.addEventListener('click', (event) => {
    // A frame of the Canvas page can reach this root, so only a real click counts.
    if (!event.isTrusted) return;
    setFullView(!isFullView());
    button.focus();
  });
  const stopWatching = watchFullView(update);
  win.addEventListener('resize', update);
  update();
  return {
    button,
    update,
    stop() {
      stopWatching();
      win.removeEventListener('resize', update);
    },
  };
}
