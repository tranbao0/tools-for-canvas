/**
 * The styles of the one assignment view (design decisions 21 and 26). The look follows Canvas:
 * Lato, the Canvas colors and InstUI chips and buttons. Three sheets: one for the nodes in the
 * Canvas page (the Preview button), one for the panel in its shadow root, and one for the
 * Submission Details view, which builds on the panel sheet. Every node and mark of the view starts with `data-av-`.
 */

/**
 * The Preview button at the end of a row, and the mark of the row that the pane shows. The marked
 * row beats the hover color of Canvas, which stays on the other rows. The colors come from the
 * school: `--ic-brand-primary` for the open row and `--ic-link-color` for the row under the mouse.
 */
export const PAGE_CSS = `
[data-av-preview]{all:unset;box-sizing:border-box;flex:none;display:inline-flex;align-items:center;gap:6px;height:30px;margin-inline-end:6px;padding:0 10px;border:1px solid #c7cdd1;border-radius:4px;background:#fff;color:var(--ic-brand-font-color-dark,#273540);font-size:13px;line-height:1;white-space:nowrap;cursor:pointer}
[data-av-preview] svg{flex:none;width:16px;height:16px}
[data-av-preview] .av-pane-fill{display:none}
.ig-row:hover [data-av-preview]{border-color:var(--ic-link-color,#0e68b3);color:var(--ic-link-color,#0e68b3)}
.ig-row [data-av-preview][aria-pressed=true],.ig-row:hover [data-av-preview][aria-pressed=true]{background:var(--ic-brand-primary,#0374b5);border-color:var(--ic-brand-primary,#0374b5);color:#fff}
[data-av-preview][aria-pressed=true] .av-pane-fill{display:inline}
.ig-row[data-av-open]{background-color:#e0ebf5!important;box-shadow:inset 3px 0 0 var(--ic-brand-primary,#0374b5)!important}
[data-av-preview]:focus-visible{outline:2px solid var(--ic-brand-primary,#0374b5);outline-offset:2px}
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
--av-ring:light-dark(var(--ic-brand-primary,#0374b5),#5a9fd4);
box-sizing:border-box;margin:0;padding:16px 24px 20px 40px;background:var(--av-bg);border-top:1px solid var(--av-soft);color:var(--av-text);font:400 14px/1.5 'Lato Extended',Lato,'Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;text-align:start;white-space:normal}
:host([data-theme=dark]) .av{color-scheme:dark}
:host([data-theme=light]) .av{color-scheme:light}
.av *{box-sizing:border-box}
.av-section{margin:0}
.av-heading{margin:0 0 6px;font-size:16px;font-weight:700;line-height:1.25}
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
.av-empty{margin:0;color:var(--av-text-2)}
@media (max-width:700px){.av{padding:12px 16px}}
`;

/**
 * The Submission Details view, after the panel rules. In the replace mode it fills the slot of the
 * files frame, which the page hides, and reads 14 px text at a 1.65 line height.
 */
export const SUBMISSION_CSS = `
:host{flex:1 1 0!important;min-width:0!important}
.av-sub{padding:16px 18px 20px;border-top:0;background:var(--av-card);font-size:14px;line-height:1.65}
.av-sub .av-heading{margin:0 0 8px;font-size:13px;font-weight:700;line-height:1.3}
.av-sub .av-body p,.av-sub .av-body ul,.av-sub .av-body ol,.av-sub .av-body blockquote,.av-sub .av-body pre,.av-sub .av-body table{margin:0 0 10px}
.av-sub .av-body ul,.av-sub .av-body ol{padding-inline-start:20px}
.av-sub .av-body[data-av-clamped]{max-height:calc(15 * 1.65em)}
.av-sub .av-body[data-av-cut]{mask-image:linear-gradient(#000 calc(100% - 3.3em),transparent)}
.av-sub .av-link{margin-top:0;font-size:13px;line-height:1.65}
.av-sub .av-submission,.av-sub .av-rubric{margin-top:18px;padding-top:12px;border-top:1px solid var(--av-soft)}
.av-sub-above{margin-bottom:12px;border:1px solid var(--av-soft)}
.av-link-text{overflow-wrap:anywhere}
`;

/**
 * The Submission box of the Submission Details page, after the panel rules. It sits in the right
 * column of Canvas, so it has no background of its own and no padding: the column pads it. The
 * heading follows `#right-side h2` of Canvas (1rem, bold, a 1px line under it), and the similarity
 * score follows `.turnitin_similarity_score` of Canvas: bold 0.75rem, 2px 4px, 3px radius, black
 * text, with the colors of its states, and gray for a pending or failed report.
 */
export const BOX_CSS = `
.av.av-box{padding:0;border-top:0;background:transparent;font-size:14px;line-height:1.5}
.av-box-title{margin:0 0 6px;padding-bottom:6px;border-bottom:1px solid var(--av-soft);font-size:1rem;font-weight:700;line-height:1.5}
.av-status{display:flex;align-items:center;gap:6px;margin-top:10px;font-size:1rem;font-weight:700}
.av-status-icon{flex:none;width:16px;height:16px}
.av-date{margin:2px 0 8px}
.av-box-files{margin:0;padding:0;list-style:none}
.av-box-file{margin:0 0 8px}
.av-box-file-name{display:flex;align-items:flex-start;gap:8px;line-height:1.4}
.av-file{overflow-wrap:anywhere;text-decoration:none}
.av-file-icon{flex:none;width:16px;height:16px;margin-top:2px;color:var(--av-text-2)}
.av-file-pdf{color:light-dark(#c0392b,#f08a8d)}
.av-box-file-meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin:5px 0 0 24px;font-size:13px}
.av-size{color:var(--av-text-2);font-size:12px;white-space:nowrap}
.av-box-report{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin:0 0 8px;font-size:13px}
.av-score{--av-score-bg:gray;--av-score-fg:#273540}
.av .av-score,.av a.av-score{display:inline-block;border-radius:3px;padding:2px 4px;background:var(--av-score-bg);color:var(--av-score-fg);font-size:.75rem;font-weight:700;line-height:1.2;text-decoration:none;white-space:nowrap}
.av-score[data-state=none]{--av-score-bg:#397af4;--av-score-fg:#000}
.av-score[data-state=acceptable]{--av-score-bg:#009917;--av-score-fg:#000}
.av-score[data-state=warning]{--av-score-bg:#897b01;--av-score-fg:#000}
.av-score[data-state=problem]{--av-score-bg:#c86604;--av-score-fg:#000}
.av-score[data-state=failure]{--av-score-bg:#ad393a;--av-score-fg:#fff}
.av-feedback{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;color:var(--av-link);font-size:13px;line-height:1.4;white-space:nowrap;cursor:pointer}
.av-feedback:hover{text-decoration:underline}
.av-feedback:focus-visible{outline:2px solid var(--av-ring);outline-offset:2px}
.av-unread{flex:none;width:8px;height:8px;border-radius:50%;background:var(--av-ring)}
.av-box-comments{margin-top:18px}
.av-box-subtitle{margin:0 0 2px;font-size:.75rem;font-weight:700;line-height:1.5}
`;
