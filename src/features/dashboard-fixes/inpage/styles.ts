/**
 * The stylesheet of the dashboard fixes. It goes in one `<style>` element of the page and in the
 * shadow roots of the fixes. The fixes set no inline style on a node that React owns, because
 * React rewrites it. They set `data-wr-` attributes, and these rules read them. See
 * docs/design.md, decision 22.
 *
 * The sections inherit the ink of the widget, and mix their borders from it, so they follow the
 * widget's dark theme.
 */
export const FIXES_CSS = `
[data-wr-grades] [data-testid=pagination-container],[data-wr-filtered] [data-testid=pagination-container],[data-wr-filtered] [data-wr-bar]>:not([data-wr-fb]):not([data-wr-own]){display:none!important}
[data-wr-paged] [data-testid=pagination-container]{display:none!important}
[data-wr-people] [data-testid=pagination-container],[data-wr-people] [data-wr-pbar]>:not([data-wr-pfb]):not([data-wr-own]){display:none!important}
[data-wr-people] [data-wr-own=pager]{display:none!important}
[data-wr-pbar]>[data-wr-list]{flex:none;min-width:0}
[data-wr-grades] [data-wr-own=pager],[data-wr-filtered] [data-wr-own=pager]{display:none!important}
.wr-pg{box-sizing:border-box;display:grid;grid-template-columns:repeat(9,minmax(0,2.25rem));justify-content:center;width:100%;margin:.5rem 0;padding:.5rem 0;font-size:.875rem;line-height:1;color:#273540;font-variant-numeric:tabular-nums}
.wr-pg button{all:unset;box-sizing:border-box;display:grid;place-items:center;height:2.25rem;min-width:0;border-radius:.25rem;color:#2b7abc;white-space:nowrap;cursor:pointer}
.wr-pg-gap{display:grid;place-items:center;height:2.25rem}
.wr-pg button[aria-current=page]{background:#0b5cad;color:#fff;font-weight:700;cursor:default}
.wr-pg .wr-pg-arrow-prev,.wr-pg .wr-pg-arrow-next{color:#273540}
.wr-pg .wr-pg-arrow-prev::before,.wr-pg .wr-pg-arrow-next::before{content:"";box-sizing:border-box;width:.5rem;height:.5rem;border:solid currentColor;transform:rotate(45deg)}
.wr-pg .wr-pg-arrow-prev::before{border-width:0 0 .125rem .125rem;margin-left:.1875rem}
.wr-pg .wr-pg-arrow-next::before{border-width:.125rem .125rem 0 0;margin-right:.1875rem}
.wr-pg button[aria-disabled=true]{color:#c7cdd1;cursor:default}
.wr-pg .wr-pg-empty{visibility:hidden}
.wr-pg button:focus-visible{outline:.125rem solid #0b5cad;outline-offset:.125rem}
.wr-pg[data-wr-dark]{color:#fff}
.wr-pg[data-wr-dark] button{color:#5a9fd4}
.wr-pg[data-wr-dark] button[aria-current=page]{color:#fff}
.wr-pg[data-wr-dark] .wr-pg-arrow-prev,.wr-pg[data-wr-dark] .wr-pg-arrow-next{color:#fff}
.wr-pg[data-wr-dark] button[aria-disabled=true]{color:#4a5b68}
.wr-pg[data-wr-dark] button:focus-visible{outline-color:#5a9fd4}
[data-wr-bar]{flex-flow:row wrap!important;align-items:flex-start!important;column-gap:.75rem}
[data-wr-bar]>[data-wr-list]{flex:1 1 100%!important;min-width:0}
.wr-filter-label{display:block;margin-bottom:.25rem}
.wr-select{position:relative;width:12rem;max-width:100%}
.wr-filter-select{box-sizing:border-box;width:100%;height:1.75rem;margin:0;padding:0 2.25rem 0 .75rem;font:inherit;font-size:.875rem;color:inherit;background:transparent;border:.0625rem solid #8d959f;border-radius:.25rem;appearance:none;cursor:pointer}
.wr-caret{position:absolute;right:.75rem;top:50%;width:.5rem;height:.5rem;margin-top:-.375rem;border:solid;border-width:0 .125rem .125rem 0;color:#586874;transform:rotate(45deg);pointer-events:none}
[data-wr-dark] .wr-caret{color:#9ea6ad}
.wr-filter-select option{color:var(--wr-option-ink);background:var(--wr-option-background)}
.wr-x-note{margin:0 0 .5rem;font-size:.75rem;opacity:.75}
.wr-body a{color:var(--ic-link-color,#0e68b3)}
[data-wr-dark] .wr-x-link,:host([data-wr-dark]) .wr-x-link,:host([data-wr-pdark]) .wr-x-link,:host([data-wr-dark]) .wr-body a{color:#5a9fd4}
.wr-x-link{all:unset;display:inline-block;margin-top:.25rem;font-size:.875rem;cursor:pointer;color:var(--ic-link-color,#0e68b3)}
.wr-x-link:hover{text-decoration:underline}
.wr-x-link:focus-visible,.wr-filter-select:focus-visible,.wr-body a:focus-visible{outline:.125rem solid var(--ic-brand-primary,#0374b5);outline-offset:.125rem}
:host{--wr-msg-line:#c7cdd1;--wr-msg-bg:#f5f5f5;--wr-line:color-mix(in srgb,currentColor 20%,transparent);--wr-secondary:#586874;--wr-field-line:#8d959f;--wr-field-bg:#fff;--wr-focus:var(--ic-brand-primary,#0374b5);--wr-check:#03893d;font-family:inherit;display:block;margin-block:.5rem .25rem;font-size:.875rem;line-height:1.4;overflow-wrap:anywhere}
:host([data-wr-dark]),:host([data-wr-pdark]){--wr-secondary:#9ea6ad;--wr-field-line:#4a5b68;--wr-field-bg:#253443;--wr-check:#6fcf8a;--wr-msg-line:#4a5b68;--wr-msg-bg:#253443;color-scheme:dark}
.wr-body{font-family:var(--ic-font-family,"Lato Extended","Lato","Helvetica Neue",Helvetica,Arial,sans-serif);font-size:16px;font-weight:400;line-height:1.5;max-height:30rem;overflow:auto}
.wr-body p{margin:12px 0}
.wr-body h1,.wr-body h2,.wr-body h3,.wr-body h4,.wr-body h5,.wr-body h6{margin:6px 0;font-family:inherit;font-weight:400;line-height:1.5}
.wr-body h1,.wr-body h2{font-size:1.8em}
.wr-body h3{font-size:1.5em}
.wr-body h4{font-size:18px}
.wr-body h5{font-size:16px}
.wr-body h6{font-size:12px}
.wr-body a{text-decoration:underline}
.wr-body ul,.wr-body ol{padding:0;margin:0 0 6px 25px}
.wr-body li>ul,.wr-body li>ol{margin-bottom:0}
.wr-body img{max-width:100%;height:auto}
.wr-body pre{white-space:pre-wrap}
.wr-body table{max-width:100%}
.wr-body table:not([cellspacing]){border-collapse:collapse;border-spacing:0}
.wr-body table:not([cellpadding]) td{padding:2px}
.wr-body td,.wr-body th{border:1px solid}
.wr-a{--wr-feed:max(20rem,min(36rem,calc(100vh - 14rem)));display:flex;flex-direction:column;box-sizing:border-box;min-width:0;height:calc(var(--wr-feed) + 2.5rem)}
.wr-a-search{flex:none;display:flex;gap:.5rem;align-items:center;height:2rem;margin-bottom:.5rem}
.wr-a-field{flex:1;min-width:0;display:flex;align-items:center;gap:.375rem;box-sizing:border-box;height:2rem;padding:0 .5rem;background:var(--wr-field-bg);border:.0625rem solid var(--wr-field-line);border-radius:.25rem;color:var(--wr-secondary)}
.wr-a-field:focus-within{border-color:var(--wr-focus);box-shadow:0 0 0 .0625rem var(--wr-focus)}
.wr-a-field svg{flex:none}
.wr-a-input{all:unset;box-sizing:border-box;flex:1;min-width:0;font:inherit;font-size:.875rem;color:inherit;cursor:text}
.wr-a-field .wr-a-input{color:currentColor}
.wr-a-field:has(.wr-a-input:not(:placeholder-shown)){color:inherit}
.wr-a-input::placeholder{color:var(--wr-secondary);opacity:1}
.wr-a-input::-webkit-search-cancel-button,.wr-a-input::-webkit-search-decoration{-webkit-appearance:none;appearance:none;display:none}
.wr-a-x,.wr-a-cal{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;flex:none;cursor:pointer;color:var(--wr-secondary)}
.wr-a-x{width:1.25rem;height:1.25rem;border-radius:50%}
.wr-a-cal{width:2rem;height:2rem;background:var(--wr-field-bg);border:.0625rem solid var(--wr-field-line);border-radius:.25rem;color:inherit}
.wr-a-cal[aria-expanded=true]{background:color-mix(in srgb,var(--wr-focus) 14%,var(--wr-field-bg));border-color:var(--wr-focus);color:var(--wr-focus)}
.wr-a-x:focus-visible,.wr-a-cal:focus-visible,.wr-a-read:focus-visible,.wr-a-scroll:focus-visible,.wr-p-message:focus-visible{outline:.125rem solid var(--wr-focus);outline-offset:.125rem}
.wr-a-dates{flex:none;display:flex;gap:.5rem;margin-bottom:.5rem}
.wr-a-dates label{flex:1;min-width:0;display:block;font-size:.75rem}
.wr-a-dates label span{display:block;margin-bottom:.125rem;font-weight:700}
.wr-a-dates .wr-a-input{display:block;width:100%;height:1.75rem;padding:0 .5rem;font-size:.75rem;background:var(--wr-field-bg);border:.0625rem solid var(--wr-field-line);border-radius:.25rem;cursor:text}
.wr-a-dates .wr-a-input:focus-visible{outline:.125rem solid var(--wr-focus);outline-offset:.0625rem}
.wr-a-res{flex:none;display:flex;justify-content:space-between;align-items:baseline;gap:.5rem;font-size:.75rem;color:var(--wr-secondary)}
.wr-a-res>span:not(:empty),.wr-a-res>.wr-x-link{margin-bottom:.25rem}
.wr-a-res .wr-x-link{margin-top:0;font-size:.75rem}
.wr-a-scroll{box-sizing:border-box;flex:1 1 0;min-height:0;overflow-y:auto;overscroll-behavior:contain;border-top:.0625rem solid var(--wr-line)}
.wr-a-row{display:grid;grid-template-columns:3.125rem minmax(0,1fr) auto;column-gap:.5rem;padding:.625rem .5rem .625rem 0;border-bottom:.0625rem solid var(--wr-line)}
.wr-a-row[data-leaving]{overflow:hidden;pointer-events:none;height:0!important;padding-block:0;border-bottom-width:0;opacity:0;transition:height .26s cubic-bezier(.4,0,.2,1),padding-top .26s cubic-bezier(.4,0,.2,1),padding-bottom .26s cubic-bezier(.4,0,.2,1),border-bottom-width .26s cubic-bezier(.4,0,.2,1),opacity .16s linear}
@media (prefers-reduced-motion:reduce){.wr-a-row[data-leaving]{transition:none}}
.wr-a-avatar{grid-column:1;grid-row:1;align-self:center;display:flex;align-items:center;justify-content:center;width:3.125rem;height:3.125rem;overflow:hidden;border-radius:50%;color:#fff;font-size:1.0625rem;font-weight:700;line-height:1;letter-spacing:.02em}
.wr-a-avatar img{display:block;width:100%;height:100%;object-fit:cover}
.wr-a-head{grid-column:2;grid-row:1;min-width:0}
.wr-a-title{font-size:.75rem;font-weight:700;line-height:1.25;overflow-wrap:anywhere}
.wr-a-meta{margin-top:.125rem;font-size:.75rem;line-height:1.4;color:var(--wr-secondary);overflow-wrap:anywhere}
.wr-a-read{all:unset;box-sizing:border-box;grid-column:3;grid-row:1;align-self:start;display:inline-flex;align-items:center;justify-content:center;width:1.5rem;height:1.5rem;margin:-.125rem -.25rem 0 0;border-radius:50%;color:var(--wr-secondary);cursor:pointer}
.wr-a-read[data-read=true]{color:var(--wr-check)}
.wr-a-read:hover{background:color-mix(in srgb,currentColor 12%,transparent)}
.wr-a-snippet{grid-column:1/-1;margin-top:.5rem;font-size:.75rem;line-height:1.4;overflow-wrap:anywhere}
.wr-a-more{grid-column:1/-1;margin-top:.25rem}
.wr-a-more .wr-x-link{margin:0}
.wr-a-body{grid-column:1/-1;margin-top:.5rem;min-width:0}
.wr-a .wr-body{max-height:none;overflow-x:auto;font-size:1rem}
.wr-a-line{margin:0;padding:.75rem 0;text-align:center;font-size:.75rem;color:var(--wr-secondary)}
.wr-a-sentinel{height:.0625rem}
.wr-p{--wr-feed:max(20rem,min(22rem,calc(100vh - 14rem)));display:flex;flex-direction:column;box-sizing:border-box;min-width:0;height:var(--wr-feed)}
.wr-p-row{display:grid;grid-template-columns:2.5rem minmax(0,1fr) 1.875rem;column-gap:.5rem;align-items:start;padding:.75rem .5rem .75rem 0;border-bottom:.0625rem solid var(--wr-line);font-size:.75rem;line-height:1.4}
.wr-p-row .wr-a-avatar{grid-row:1;align-self:start;width:2.5rem;height:2.5rem;font-size:.875rem}
.wr-p-info{grid-column:2;min-width:0}
.wr-p-name{font-size:.875rem;font-weight:700;line-height:1.3;overflow-wrap:anywhere}
.wr-p-enrollment+.wr-p-enrollment{margin-top:.375rem}
.wr-p-course,.wr-p-role{overflow-wrap:anywhere}
.wr-p-message{all:unset;box-sizing:border-box;grid-column:3;grid-row:1;display:flex;align-items:center;justify-content:center;width:1.875rem;height:1.875rem;background:var(--wr-msg-bg);border:.0625rem solid var(--wr-msg-line);border-radius:.25rem;color:inherit;cursor:pointer}
.wr-p-message:hover{background:color-mix(in srgb,currentColor 10%,var(--wr-msg-bg))}
mark{background:#fdeeb5;color:#273540;padding:0 .0625rem;border-radius:.125rem}
:host([data-wr-dark]) mark{background:#6b5810;color:#fff}
`;
