/**
 * The stylesheet of the dashboard fixes. It goes in one `<style>` element of the page and in the
 * shadow roots of the fixes. The fixes set no inline style on a node that React owns, because
 * React rewrites it. They set `data-wr-` attributes, and these rules read them. See
 * docs/design.md, decision 22.
 *
 * The sections inherit the ink of the widget, and mix their borders from it, so they follow the
 * widget's dark theme. The pill colors are the status colors of the widget package.
 */
export const FIXES_CSS = `
[data-wr-cc]{background-color:var(--wr-cc)!important}
[data-wr-cc] svg,[data-wr-cc] span{color:var(--wr-cc-fg)!important}
[data-wr-title]{cursor:pointer}
[data-wr-title]:hover{text-decoration:underline}
[data-wr-open] [data-wr-snippet],[data-wr-open] [data-wr-more],[data-wr-gone],[data-wr-grades] [data-testid=pagination-container],[data-wr-filtered] [data-wr-content],[data-wr-filtered] [data-testid=pagination-container]{display:none!important}
[data-wr-bar]{flex-flow:row wrap!important;align-items:flex-end!important;column-gap:.75rem}
[data-wr-bar]>[data-wr-content],[data-wr-bar]>[data-wr-list]{flex:1 1 100%!important;min-width:0}
.wr-filter-label{display:block;margin-bottom:.25rem}
.wr-select{position:relative;width:12rem;max-width:100%}
.wr-filter-select{box-sizing:border-box;width:100%;height:1.75rem;margin:0;padding:0 2.25rem 0 .75rem;font:inherit;font-size:.875rem;color:inherit;background:transparent;border:.0625rem solid #8d959f;border-radius:.25rem;appearance:none;cursor:pointer}
.wr-caret{position:absolute;right:.75rem;top:50%;width:.5rem;height:.5rem;margin-top:-.375rem;border:solid;border-width:0 .125rem .125rem 0;color:#586874;transform:rotate(45deg);pointer-events:none}
[data-wr-dark] .wr-caret{color:#9ea6ad}
[data-wr-read] [data-testid^=mark-read-] svg{display:none}
[data-wr-read] [data-testid^=mark-read-]{display:inline-flex;align-items:center;justify-content:center}
[data-wr-read] [data-testid^=mark-read-]::after{content:"";width:.3rem;height:.6rem;margin-top:-.15rem;border:solid #03893d;border-width:0 .15rem .15rem 0;transform:rotate(45deg)}
[data-wr-dark] [data-wr-read] [data-testid^=mark-read-]::after{border-color:#6fcf8a}
.wr-filter-select option{color:#2d3b45}
.wr-x{margin-top:1rem;padding-top:.75rem;border-top:.0625rem solid color-mix(in srgb,currentColor 20%,transparent)}
.wr-x h3{margin:0 0 .25rem;font-size:1rem;font-weight:700}
.wr-x ul{margin:0;padding:0;list-style:none}
.wr-x-note{margin:0 0 .5rem;font-size:.75rem;opacity:.75}
.wr-x-info{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;width:1rem;height:1rem;margin-inline-start:.375rem;border:.0625rem solid currentColor;border-radius:50%;font-size:.625rem;font-weight:700;line-height:1;cursor:help;vertical-align:middle}
.wr-x-info:focus-visible{outline:.125rem solid var(--ic-brand-primary,#0374b5);outline-offset:.125rem}
.wr-x-row{display:flex;align-items:center;gap:.75rem;padding:.5rem 0;border-top:.0625rem solid color-mix(in srgb,currentColor 12%,transparent)}
.wr-x-icon{flex:none;display:inline-flex;align-items:center;justify-content:center;width:2.5rem;height:2.5rem;border-radius:.375rem}
.wr-x-main{flex:1;min-width:0}
.wr-x-title{display:block;font-size:.875rem;font-weight:700}
a.wr-x-title,.wr-body a{color:var(--ic-link-color,#0e68b3)}
a.wr-x-title{text-decoration:none}
a.wr-x-title:hover{text-decoration:underline}
.wr-x-meta{font-size:.75rem;opacity:.75}
.wr-x-pill{flex:none;max-width:45%;padding:.25rem .5rem;border-radius:1rem;font-size:.75rem;font-weight:700;text-align:center;background:#e0ebf5;color:#1a5a8e}
.wr-x-undated{background:#e8eaec;color:#6a7883}
.wr-x-overdue{background:#fce4e5;color:#c4191f}
[data-wr-dark] a.wr-x-title,[data-wr-dark] .wr-x-link,:host([data-wr-dark]) .wr-x-link,:host([data-wr-dark]) .wr-body a{color:#5a9fd4}
[data-wr-dark] .wr-x-pill{background:#253443;color:#5a9fd4}
[data-wr-dark] .wr-x-undated{color:#9ea6ad}
[data-wr-dark] .wr-x-overdue{color:#f08a8d}
.wr-x-link{all:unset;display:inline-block;margin-top:.25rem;font-size:.875rem;cursor:pointer;color:var(--ic-link-color,#0e68b3)}
.wr-x-link:hover{text-decoration:underline}
.wr-x-link:focus-visible,.wr-filter-select:focus-visible,.wr-body a:focus-visible{outline:.125rem solid var(--ic-brand-primary,#0374b5);outline-offset:.125rem}
:host{display:block;margin-block:.5rem .25rem;font-size:var(--wr-fs,.875rem);line-height:var(--wr-lh,1.4);overflow-wrap:anywhere}
.wr-body{max-height:30rem;overflow:auto}
.wr-body>:first-child{margin-top:0}
.wr-body p,.wr-body ul,.wr-body ol,.wr-body blockquote,.wr-body pre,.wr-body table{margin:0 0 .5rem}
.wr-body>:last-child{margin-bottom:0}
.wr-body ul,.wr-body ol{padding-inline-start:1.25rem}
.wr-body img{display:block;max-width:100%;height:auto;margin:0 0 .5rem}
.wr-body pre{white-space:pre-wrap}
.wr-body table{border-collapse:collapse}
.wr-body td,.wr-body th{border:.0625rem solid;padding:.25rem .5rem}
.wr-item{padding-block:.5rem;border-bottom:.0625rem solid color-mix(in srgb,currentColor 20%,transparent)}
`;
