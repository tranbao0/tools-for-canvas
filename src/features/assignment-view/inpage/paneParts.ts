/**
 * The parts that the panes of the assignment view share: the header rules and the icons. The
 * panes sit in the dock of the file pane (decision 25), which gives the frame and the colors.
 */

/** The bar is as high as the tab row of the file pane: 44 px of tab and the 3 px of its underline. */
export const PANE_CSS = `
.bar{box-sizing:border-box;display:flex;flex:none;align-items:center;gap:8px;height:47px;padding:0 0 0 14px;border-bottom:1px solid var(--line);color:var(--text);font-size:14px;line-height:20px}
.title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.btn{box-sizing:border-box;display:inline-flex;flex:none;align-items:center;gap:8px;min-height:28px;padding:2px 8px;border:1px solid var(--btn-line);border-radius:4px;background:var(--hover);color:var(--text);font:inherit;font-size:14px;line-height:1.125;text-decoration:none;white-space:nowrap}
.btn:hover{background:var(--btn-hover);text-decoration:none}
.icon-btn{box-sizing:border-box;display:inline-flex;flex:none;align-items:center;justify-content:center;min-width:28px;height:28px;margin:0 8px;padding:0 6px;border:0;border-radius:4px;background:transparent;color:var(--text);cursor:pointer}
.icon-btn:hover{background:var(--hover)}
a:focus-visible,button:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
svg{display:block;flex:none;width:16px;height:16px}
`;

const SVG = 'http://www.w3.org/2000/svg';

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
