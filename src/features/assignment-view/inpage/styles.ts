/**
 * The styles of the one assignment view (design decisions 21 and 26). The look follows Canvas:
 * Lato, the Canvas colors and InstUI chips and buttons. Two sheets: one for the nodes in the
 * Canvas page (the toggle button and the row that holds the panel), and one for the panel in its
 * shadow root. Every node and mark of the view starts with `data-av-`.
 */

/** The toggle button in the title cell, and the table row that holds the panel. */
export const PAGE_CSS = `
[data-av-toggle]{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;margin-inline-end:6px;border-radius:4px;vertical-align:middle;color:inherit;cursor:pointer}
[data-av-toggle]::before{content:'';width:7px;height:7px;margin-inline-start:-2px;border:solid currentColor;border-width:0 2px 2px 0;transform:rotate(-45deg);transition:transform .15s}
[data-av-toggle][aria-expanded=true]::before{margin:-3px 0 0;transform:rotate(45deg)}
[data-av-toggle]:hover{background:color-mix(in srgb,currentColor 12%,transparent)}
[data-av-toggle]:focus-visible{outline:2px solid var(--ic-brand-primary,#0374b5);outline-offset:1px}
tr[data-av-details]>td{padding:0!important;border:0!important;background:none!important}
tr[data-av-details][hidden]{display:none!important}
@media (prefers-reduced-motion:reduce){[data-av-toggle]::before{transition:none}}
`;

/** The panel in the shadow root. Custom properties cross the boundary, so the school brand shows. */
export const PANEL_CSS = `
:host{all:initial!important;display:block!important;direction:ltr!important}
.av{color-scheme:light dark;
--av-text:light-dark(var(--ic-brand-font-color-dark,#273540),#fff);
--av-text-2:light-dark(#586874,#9ea6ad);
--av-link:light-dark(var(--ic-link-color,#0e68b3),#5a9fd4);
--av-bg:light-dark(#f5f5f5,#1f2d3d);
--av-card:light-dark(#fff,#1b2330);
--av-line:light-dark(#c7cdd1,#4a5b68);
--av-soft:light-dark(#e8eaec,#2e3e4e);
--av-pill:light-dark(#6a7883,#9ea6ad);
--av-danger:light-dark(#c71f23,#f08a8d);
--av-selected:light-dark(#e0ebf5,#253443);
--av-ring:light-dark(var(--ic-brand-primary,#0374b5),#5a9fd4);
box-sizing:border-box;margin:0;padding:16px 24px 20px 40px;background:var(--av-bg);border-top:1px solid var(--av-soft);color:var(--av-text);font:400 14px/1.5 'Lato Extended',Lato,'Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;text-align:start;white-space:normal}
:host([data-theme=dark]) .av{color-scheme:dark}
:host([data-theme=light]) .av{color-scheme:light}
.av *{box-sizing:border-box}
.av-content{display:flex;flex-direction:column;gap:20px;max-width:960px}
.av-summary{display:flex;flex-wrap:wrap;align-items:center;gap:8px 24px}
.av-facts{display:flex;flex-wrap:wrap;gap:4px 32px;margin:0}
.av-fact{display:flex;flex-direction:column}
.av-label{margin:0;color:var(--av-text-2);font-size:12px;line-height:1.3}
.av-value{margin:0;font-weight:700}
.av-chips{display:flex;flex-wrap:wrap;gap:8px;margin:0;padding:0;list-style:none}
.av-chip{display:inline-flex;align-items:center;min-height:24px;padding:2px 8px;border:1px solid var(--av-pill);border-radius:12px;background:var(--av-card);color:var(--av-pill);line-height:18px}
.av-chip-missing{border-color:var(--av-danger);color:var(--av-danger)}
.av-marker{color:var(--av-text-2);font-size:12px}
.av-section{margin:0}
.av-heading{margin:0 0 6px;font-size:16px;font-weight:700;line-height:1.25}
.av-subheading{margin:0;font-size:14px;font-weight:700}
.av-body{overflow-wrap:anywhere}
.av-body[data-av-clamped]{max-height:15em;overflow:hidden}
.av-body[data-av-cut]{mask-image:linear-gradient(#000 calc(100% - 3em),transparent)}
.av [hidden]{display:none!important}
.av-body>:first-child{margin-top:0}
.av-body>:last-child{margin-bottom:0}
.av-body p,.av-body ul,.av-body ol,.av-body blockquote,.av-body pre,.av-body table{margin:0 0 8px}
.av-body ul,.av-body ol{padding-inline-start:24px}
.av-body img{display:block;max-width:100%;height:auto;margin:0 0 8px}
.av-body pre{white-space:pre-wrap}
.av-body table{border-collapse:collapse}
.av-body td,.av-body th{padding:4px 8px;border:1px solid var(--av-line)}
.av a,.av-link{color:var(--av-link)}
.av a:hover,.av-link:hover{text-decoration:underline}
.av a:focus-visible,.av button:focus-visible{outline:2px solid var(--av-ring);outline-offset:2px}
.av-link{all:unset;display:inline-block;margin-top:6px;color:var(--av-link);cursor:pointer}
.av-link:hover{text-decoration:underline}
.av-link:focus-visible{outline:2px solid var(--av-ring);outline-offset:2px}
.av-criterion{margin:0 0 12px;padding:12px;border:1px solid var(--av-line);border-radius:4px;background:var(--av-card)}
.av-criterion>.av-note{margin:2px 0 0}
.av-ratings{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 0;padding:0;list-style:none}
.av-rating{display:flex;flex-direction:column;gap:2px;min-width:112px;max-width:240px;padding:8px 12px;border:1px solid var(--av-line);border-radius:4px}
.av-rating[data-assessed]{border:2px solid var(--av-ring);padding:7px 11px;background:var(--av-selected)}
.av-mark{align-self:flex-start;padding:0 6px;border-radius:10px;background:var(--av-ring);color:light-dark(#fff,#10141a);font-size:12px;font-weight:700}
.av-note,.av-comment .av-body{white-space:pre-line}
.av-note{margin:0;color:var(--av-text-2);font-size:13px}
.av-result{margin:8px 0 0;font-weight:700}
.av-comment{margin:0 0 8px;padding:10px 12px;border:1px solid var(--av-line);border-radius:4px;background:var(--av-card)}
.av-comment[data-author=self]{background:var(--av-selected)}
.av-comment-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 12px;margin-bottom:4px}
.av-time{color:var(--av-text-2);font-size:12px}
.av-comment .av-file{display:block;margin-top:6px}
.av-file-list{margin:0;padding:0;list-style:none}
.av-file-list li{margin:0 0 4px}
.av-empty,.av-state{margin:0;color:var(--av-text-2)}
.av-error{display:flex;flex-wrap:wrap;align-items:center;gap:12px;color:var(--av-danger)}
.av-actions{display:flex;gap:8px}
.av-button{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;min-height:32px;padding:2px 12px;border:1px solid var(--av-line);border-radius:4px;background:var(--av-card);color:var(--av-text)!important;font-size:14px;line-height:1.125;cursor:pointer}
.av-button:hover{background:var(--av-soft);text-decoration:none!important}
.av-button:focus-visible{outline:2px solid var(--av-ring);outline-offset:2px}
@media (max-width:700px){.av{padding:12px 16px}.av-rating{max-width:none;flex:1 1 100%}}
`;
