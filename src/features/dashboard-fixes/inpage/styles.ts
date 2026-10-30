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
.wr-filter-label{display:block;font-size:.875rem;margin-bottom:.25rem}
.wr-filter-select{box-sizing:border-box;width:12rem;max-width:100%;height:1.75rem;padding:0 1.75rem 0 .5rem;font:inherit;font-size:.875rem;color:inherit;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2 4l4 4 4-4' fill='none' stroke='%236b7780' stroke-width='1.6'/%3E%3C/svg%3E") right .5rem center/.75rem no-repeat;border:.0625rem solid #8d959f;border-radius:.25rem;appearance:none;cursor:pointer}
.wr-filter-select option{color:#2d3b45}
.wr-x{margin-top:1rem;padding-top:.75rem;border-top:.0625rem solid color-mix(in srgb,currentColor 20%,transparent)}
.wr-x h3{margin:0 0 .25rem;font-size:1rem}
.wr-x ul{margin:0;padding:0;list-style:none}
.wr-x-note{margin:0 0 .5rem;font-size:.75rem;opacity:.75}
.wr-x-row{display:flex;align-items:center;gap:.75rem;padding:.5rem 0;border-top:.0625rem solid color-mix(in srgb,currentColor 12%,transparent)}
.wr-x-icon{flex:none;display:inline-flex;align-items:center;justify-content:center;width:2.5rem;height:2.5rem;border-radius:.375rem}
.wr-x-main{flex:1;min-width:0}
.wr-x-title{display:block;font-size:.875rem;font-weight:700}
a.wr-x-title,.wr-x-link,.wr-body a{color:var(--ic-link-color,#0e68b3)}
a.wr-x-title{text-decoration:none}
a.wr-x-title:hover{text-decoration:underline}
.wr-x-meta{font-size:.75rem;opacity:.75}
.wr-x-pill{flex:none;max-width:45%;padding:.25rem .5rem;border-radius:1rem;font-size:.75rem;font-weight:700;text-align:center;background:#e0ebf5;color:#1a5a8e}
.wr-x-undated{background:#e8eaec;color:#6a7883}
.wr-x-overdue{background:#fce4e5;color:#c4191f}
[data-wr-dark] .wr-x-pill{background:#253443;color:#5a9fd4}
[data-wr-dark] .wr-x-undated{color:#9ea6ad}
[data-wr-dark] .wr-x-overdue{color:#f08a8d}
.wr-x-link{all:unset;display:inline-block;margin-top:.25rem;font-size:.875rem;cursor:pointer}
.wr-x-link:hover{text-decoration:underline}
.wr-x-link:focus-visible,.wr-filter-select:focus-visible,.wr-body a:focus-visible{outline:.125rem solid var(--ic-brand-primary,#0374b5);outline-offset:.125rem}
:host{display:block;margin-block:.5rem .25rem;font-size:.875rem;line-height:1.4;overflow-wrap:anywhere}
.wr-body{max-height:30rem;overflow:auto}
.wr-body>:first-child{margin-top:0}
.wr-body img{max-width:100%;height:auto}
.wr-body pre{white-space:pre-wrap}
.wr-body table{border-collapse:collapse}
.wr-body td,.wr-body th{border:.0625rem solid;padding:.25rem .5rem}
.wr-item{padding-block:.5rem;border-bottom:.0625rem solid color-mix(in srgb,currentColor 20%,transparent)}
`;
