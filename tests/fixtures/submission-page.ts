import { readFileSync } from 'node:fs';
import { frameRows, type FrameRow } from './submission-frame';

/**
 * The Submission Details page as canvas-lms 1c9f0bb draws it (`app/views/submissions/show.html.erb`
 * and `show_preview.html.erb`): the header, the title row with its buttons, and the content
 * container with the files frame on the left and the comments column on the right. The styles
 * follow `app/stylesheets/bundles/submission.scss`. The copy of the markup is trimmed to the parts
 * that a test reads.
 */

export interface SubmissionPageOptions {
  course?: string;
  assignment?: string;
  user?: string;
  /** The page of a teacher: SpeedGrader instead of "Re-submit Assignment". */
  teacher?: boolean;
  /** No attempts are left: Canvas draws "Re-submit Assignment" with the `disabled` attribute. */
  noAttemptsLeft?: boolean;
  /** The container has no button: the user may not submit and is no teacher. */
  noButton?: boolean;
  /** The address of the files frame. */
  frameSrc?: string;
  /**
   * An assignment with a rubric: "Show Rubric" in the header, the hidden `#rubric_holder` and the
   * assessment of the student. A page without a rubric has neither the link nor the holder.
   */
  rubric?: boolean;
  /** The rubric has comments that the student has not read: Canvas draws its unread mark. */
  rubricUnread?: boolean;
  /** The holder is on the page, but Canvas draws no "Show Rubric" (the grade is not posted). */
  rubricWithoutLink?: boolean;
  /** The course menu: the body class `course-menu-expanded` and the visible `#left-side`. */
  menu?: 'open' | 'closed';
  /** The comments list has no comment yet. */
  noComments?: boolean;
  /** The comment form does not show: the student may not comment (`add_comment_form` is hidden). */
  noCommentForm?: boolean;
}

const CSS = readFileSync('tests/fixtures/pages/canvas-layout.css', 'utf8');

const RUBRIC_STYLE = `
.rubric { max-width: 600px; }
.rubric_table { width: 100%; border-collapse: collapse; font-size: 14px; }
.rubric_table caption { display: none; }
.rubric_table th, .rubric_table td { border: 1px solid #c7cdd1; padding: 6px; text-align: left; vertical-align: top; }
.rubric_table .ratings { display: flex; }
.rubric_table .rating { flex: 1; padding: 4px; border-inline-end: 1px solid #c7cdd1; }
.rubric_table .rating.selected { background: #e0ebf5; font-weight: 700; }
.rubric_table .small_description { display: block; font-size: 12px; color: #586874; }
.rubric-footer { text-align: right; font-size: 14px; padding-top: 6px; }
.screenreader-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.hide_rubric_link { cursor: pointer; }
.hide_rubric_link .icon-x { display: inline-block; width: 16px; height: 16px; background: #586874; }
`;

/**
 * The rubric of canvas-lms 1c9f0bb: the link in the header (`show.html.erb` lines 186-203) and the
 * holder (lines 275-322) with the rubric partial (`shared/_rubric.html.erb`, `_rubric_criterion.html.erb`)
 * as a student sees it, trimmed to the parts that a test reads. The server renders the holder hidden.
 */
function rubricLink(unread: boolean): string {
  const title = unread ? 'There are unread rubric comments.' : '';
  const mark = unread
    ? '<span class="rubric_comment unread_indicator" aria-hidden="true"></span>'
    : '';
  return `<div class="submission-details-header__rubric"><a href="#" class="assess_submission_link Button Button--small Button--link" tabindex="0" title="${title}"><i class="icon-rubric" aria-hidden="true"></i>Show Rubric</a>${mark}</div>`;
}

function criterion(id: string, title: string, long: string, ratings: [string, string][]): string {
  const cells = ratings
    .map(
      ([points, text], index) =>
        `<div class="rating ${index === 0 || index === ratings.length - 1 ? 'edge_rating' : ''}"><div class="container"><div class="rating-main"><span role="text" class="rating-content-wrapper"><span class="nobr toggle_for_hide_points"><span class="points">${points}</span> pts</span> <span class="description rating_description_value">${text}</span></span><span class="rating_id" style="display: none;">r${id}_${index}</span></div></div></div>`,
    )
    .join('');
  return `<tr id="criterion_${id}" class="criterion"><td class="criterion_description hover-container pad-box-micro" aria-label="description of criterion"><div class="criterion_description_container"><div class="description_content"><span role="text"><span class="description description_title">${title}</span><span class="criterion_id" style="display: none;">${id}</span><div class="long_description small_description">${long}</div></span></div></div></td><td style="padding: 0;" aria-label="criterion ratings"><div class="ratings">${cells}</div></td><td class="nobr points_form toggle_for_hide_points" aria-label="criterion points"><div class="displaying" role="text"><span style="white-space: nowrap;"><span class="criterion_rating_points_holder" style="display: none;"><span class="criterion_rating_points">&nbsp;</span> /</span> <span class="display_criterion_points">${ratings[0]![0]}</span> pts</span></div></td></tr>`;
}

const RUBRIC_HOLDER = `<div id="rubric_holder" style="position: absolute; right: 0px; padding: 5px; background-color: #fff; border: 1px solid #aaa; border-right-width: 0; display: none;">
    <a class="hide_rubric_link" style="float: right; margin-right:0 !important;" title="Hide Rubric" role="button" aria-label="Hide Rubric" tabindex="0"><i class="icon-x standalone-icon"></i></a>
    <div id="rubric_assessments_list" style="text-align: right; margin-bottom: 5px;">
      <label for="rubric_assessments_select">Show Assessment By:</label>
      <select id="rubric_assessments_select"><option id="rubric_assessment_option_9" value="9">Teacher</option></select>
    </div>
    <div class="rubric_container rubric" id="rubric_31">
      <div class="screenreader-only rubric-screenreader-title"><h2>Rubric</h2></div>
      <table class="rubric_table">
        <caption><div class="screenreader-only"><span class="title">Reflection rubric</span></div></caption>
        <thead><tr><th scope="col">Criteria</th><th scope="col">Ratings</th><th scope="col" class="toggle_for_hide_points">Pts</th></tr></thead>
        <tbody>
          ${criterion('c1', 'Argument', 'A clear claim that the sources support.', [
            ['20', 'Full marks'],
            ['10', 'Partial'],
            ['0', 'No marks'],
          ])}
          ${criterion('c2', 'Evidence', 'At least four credible sources, cited in IEEE style.', [
            ['20', 'Full marks'],
            ['10', 'Partial'],
            ['0', 'No marks'],
          ])}
        </tbody>
      </table>
      <div class="rubric-footer"><div class="total_points_holder toggle_for_hide_points"><span role="text">Total Points: <span class="assessing"><span class="rubric_total">30</span> out of 40</span></span></div></div>
    </div>
    <div class="button-container"></div>
    <a href="/courses/12/rubric_associations/7/rubric_assessments" class="update_rubric_assessment_url" style="display: none;">&nbsp;</a>
  </div>`;

/**
 * The part of the script of Canvas (`ui/features/submissions/jquery/index.tsx`) that touches the
 * holder: the assessment is filled in when the page is ready (lines 661-683), `makeRubricAccessible`
 * traps Tab, closes on Escape and marks the rest of the page (lines 177-219), and the two links open
 * and close the holder (lines 220-236, 647-660).
 */
const RUBRIC_SCRIPT = `
document.addEventListener('DOMContentLoaded', function () {
  var holder = document.getElementById('rubric_holder');
  var assessed = { c1: 0, c2: 1 };
  Object.keys(assessed).forEach(function (id) {
    var rating = holder.querySelectorAll('#criterion_' + id + ' .rating')[assessed[id]];
    rating.classList.add('selected');
  });
  window.__canvasRubric = { opened: 0, closed: 0 };
  var tabbables = holder.querySelectorAll('a[tabindex], select, button');
  var first = tabbables[0], last = tabbables[tabbables.length - 1];
  function close() { window.__canvasRubric.closed++; holder.style.display = 'none'; var ariaSetting = holder.offsetParent !== null; document.querySelectorAll('[data-hide_from_rubric]').forEach(function (n) { n.setAttribute('aria-hidden', String(ariaSetting)); }); var link = document.querySelector('.assess_submission_link'); if (link) link.focus(); }
  holder.querySelector('.hide_rubric_link').addEventListener('click', function (e) { e.preventDefault(); close(); });
  [first, last].forEach(function (el) {
    el.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      var leaving = el === first ? e.shiftKey : !e.shiftKey;
      if (leaving) { e.preventDefault(); (el === first ? last : first).focus(); }
    });
  });
  Array.prototype.forEach.call(tabbables, function (el) {
    el.addEventListener('keydown', function (e) { if (e.key === 'Escape') holder.querySelector('.hide_rubric_link').click(); });
  });
  // makeRubricAccessible marks the siblings of the holder and the siblings of every ancestor up to #application.
  function siblingsOf(node) { return Array.prototype.filter.call(node.parentNode.children, function (n) { return n !== node; }); }
  siblingsOf(holder).forEach(function (n) { n.setAttribute('data-hide_from_rubric', 'true'); });
  for (var up = holder.parentNode; up && up.id !== 'application'; up = up.parentNode) {
    siblingsOf(up).forEach(function (n) { if (n.id !== 'aria_alerts') n.setAttribute('data-hide_from_rubric', 'true'); });
  }
  var link = document.querySelector('.assess_submission_link');
  if (link) link.addEventListener('click', function (e) {
    e.preventDefault();
    window.__canvasRubric.opened++;
    var dot = document.querySelector('.rubric_comment.unread_indicator');
    if (dot) { dot.style.display = 'none'; link.setAttribute('title', ''); }
    holder.style.display = 'block';
    document.querySelectorAll('[data-hide_from_rubric]').forEach(function (n) { n.setAttribute('aria-hidden', 'true'); });
    holder.querySelector('.hide_rubric_link').focus();
  });
  if (location.hash === '#rubric' && link) link.click();
});
`;

/**
 * The rules of canvas-lms 1c9f0bb (`common.css`, from the production CSS, lines 2187, 2212-2232,
 * 2247-2251 and 2369 of the rules list) that place the right column of the layout, copied as they
 * are. Canvas draws `#right-side` empty on this page and hides its wrapper, because the body has no
 * class `with-right-side`. The layout caps its width at 1366 px.
 */
const LAYOUT_RULES = `
#right-side-wrapper{display:none;position:relative}
.with-right-side #right-side-wrapper{display:block}
body:not(.ic-no-flex-layout):not(.embedded) .ic-app-main-content{box-sizing:border-box;flex:1;min-width:1px}
.ic-Layout-contentWrapper{box-sizing:border-box}
.ic-Layout-contentMain{padding:36px 48px 48px 48px}
.ic-app-main-content__secondary{box-sizing:border-box;min-width:1px;padding:24px}
.ic-app-main-content__secondary{position:relative;-webkit-transform:translate3d(0, 0, 0)}
@media only screen and (min-width: 1140px){body.course-menu-expanded:not(.ic-no-flex-layout):not(.embedded) .ic-app-main-content{display:flex}}
@media only screen and (min-width: 1140px){body.course-menu-expanded:not(.ic-no-flex-layout):not(.embedded) .ic-Layout-contentWrapper{flex:1;min-width:1px}}
@media only screen and (min-width: 1140px){body.course-menu-expanded .ic-app-main-content__secondary{width:288px;padding-left:24px}}
@media only screen and (min-width: 992px){body:not(.course-menu-expanded):not(.ic-no-flex-layout):not(.embedded) .ic-app-main-content{display:flex}}
@media only screen and (min-width: 992px){body:not(.course-menu-expanded):not(.ic-no-flex-layout):not(.embedded) .ic-Layout-contentWrapper{flex:1;min-width:1px}}
@media only screen and (min-width: 992px){body:not(.course-menu-expanded) .ic-app-main-content__secondary{width:288px;padding-left:24px}}
.ic-Layout-wrapper{box-sizing:border-box;min-height:100vh}
body:not(.full-width):not(.outcomes):not(.body--login-confirmation):not(.content-only) .ic-Layout-wrapper{max-width:1366px}
@media(min-width: 768px){body:not(.no-headers):not(.content-only):not(.hide-global-nav) .ic-Layout-wrapper{margin-left:54px}}
@media(min-width: 768px){body:not(.no-headers):not(.content-only):not(.hide-global-nav).primary-nav-expanded .ic-Layout-wrapper{margin-left:84px}}
#right-side{position:relative;z-index:10;min-height:20px}
#right-side h2,#right-side .h2{font-size:16px;font-size:1rem;overflow:hidden;border-bottom:1px solid #e8eaec;padding-bottom:6px;margin:0 0 6px;font-weight:bold}
.ic-Layout-wrapper{margin:auto}
`;

const COMMENT_STYLE = `
.submission-details-comments { box-sizing: border-box; border-top: 1px solid #e8eaec; }
@media (min-width: 992px) { .submission-details-comments { flex: 0 0 280px; border-top: none; } }
.submission-details-comments .comments { height: 300px; overflow: auto; background-color: #f5f5f5; }
@media (min-width: 992px) { .submission-details-comments .comments { border-left: 1px solid #e8eaec; } }
.submission-details-comments .comment_author_and_date { color: #888888; }
#add_comment_form label.add_a_comment { font-size: 1rem; }
#textarea-container { position: relative; margin-bottom: 8px; }
.ic-Input { box-sizing: border-box; width: 100%; min-height: 70px; padding: 8px 12px; border: 1px solid #8d959f; border-radius: 3px; font: inherit; font-size: 14px; background: #fff; color: #273540; }
#emoji-quick-picker-container { margin: 6px 0; }
.clearfix::after { content: ''; display: table; clear: both; }
.pull-left { float: left; }
.button-container { margin-top: 8px; }
`;

/**
 * The part of the script of Canvas (`ui/features/submissions/jquery/index.tsx`) that sizes the
 * page and saves a comment: a click on `.save_comment_button` (line 380 binds it directly on the button) reads the
 * text of `.grading_comment` and draws a new `.comment` in `.comments .comment_list` with document
 * lookups, then clears the text (lines 99-117). The copy makes no request. It works only while the
 * column is in the light DOM, as Canvas's script does.
 */
const COMMENT_SCRIPT = `
document.addEventListener('DOMContentLoaded', function () {
  // windowResize (lines 310-316): the frame as high as the screen, the comments with a maximum
  // height, and the rubric holder above the right column.
  function windowResize() {
    var height = window.screen.height - 20;
    var frame = document.getElementById('preview_frame');
    if (frame) frame.style.height = height + 'px';
    var holder = document.getElementById('rubric_holder');
    if (holder) { holder.style.maxHeight = (height - 50) + 'px'; holder.style.overflow = 'auto'; holder.style.zIndex = '5'; }
    var comments = document.querySelector('.comments');
    if (comments) comments.style.maxHeight = height + 'px';
  }
  window.addEventListener('resize', windowResize);
  windowResize();
  var save = document.querySelector('.save_comment_button');
  if (!save) return;
  window.__canvasComments = { saved: 0 };
  save.addEventListener('click', function () {
    var area = document.querySelector('.grading_comment');
    var text = area.value.trim();
    if (!text) return;
    window.__canvasComments.saved++;
    var comment = document.getElementById('comment_blank').cloneNode(true);
    comment.removeAttribute('id');
    comment.style.display = '';
    comment.querySelector('span.comment').textContent = text;
    comment.querySelector('.author_name').textContent = 'Bao Tran';
    document.querySelector('.comments .comment_list').appendChild(comment);
    area.value = '';
  });
});
`;

const STYLE = `
.submission-details-header { margin-bottom: 12px; }
.submission-details-header__heading-and-grades { display: flex; align-items: center; border-bottom: 1px solid #c7cdd1; padding-bottom: 12px; margin-bottom: 12px; }
.submission-details-header__heading { margin: 0; flex: 1; min-width: 1px; font-size: 24px; line-height: 1.25; }
.submission-details-header__grade-summary { text-align: right; }
.submission-details-header__rubric { text-align: right; }
.ic-Action-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; }
.ic-Action-header__Primary h2 { font-size: 20px; line-height: 1.3; margin: 0 0 4px; }
.submission-details-header__info { font-size: 14px; }
.Button { display: inline-block; white-space: nowrap; padding: 8px 12px; border: 1px solid #c7cdd1; border-radius: 3px; font-size: 14px; background: #f5f5f5; color: #273540; }
.Button--primary { background: #0374b5; border-color: #0374b5; color: #fff; font-weight: 700; }
.Button--link { background: none; border: 0; color: #0e68b3; padding: 0; }
.submission-details-container { border: 1px solid #e8eaec; box-sizing: border-box; display: flex; margin-top: 12px; }
.submission-details-frame { box-sizing: border-box; flex: 1; }
`;

/** The top page of a student's own submission, or of a teacher who looks at it. */
export function submissionDetailsPage(options: SubmissionPageOptions = {}): string {
  const course = options.course ?? '12';
  const assignment = options.assignment ?? '101';
  const user = options.user ?? '42';
  const page = `/courses/${course}/assignments/${assignment}/submissions/${user}`;
  const src = options.frameSrc ?? `${page}?preview=1&rand=481516`;
  const hasHolder = options.rubric === true || options.rubricWithoutLink === true;
  const action = options.noButton
    ? ''
    : options.teacher
      ? `<a class="Button" href="/courses/${course}/gradebook/speed_grader?assignment_id=${assignment}&amp;student_id=${user}" target="_blank" rel="noopener"><i class="icon-speed-grader" aria-hidden="true"></i> SpeedGrader</a>`
      : `<a href="/courses/${course}/assignments/${assignment}#submit" class="Button Button--primary"${options.noAttemptsLeft ? ' disabled' : ''}>Re-submit Assignment</a>`;
  return `<!doctype html>
<html lang="en" dir="ltr"><head><meta charset="utf-8"><title>Reflection Paper #1: Submission Details</title>
<style>${CSS}${STYLE}${COMMENT_STYLE}${LAYOUT_RULES}${RUBRIC_STYLE}</style>
<script>INST = { environment: 'production' }; ENV = { current_user_id: '5501', SUBMISSION: { assignment_id: '${assignment}', user_id: '${user}' } };</script>
${hasHolder ? `<script>${RUBRIC_SCRIPT}</script>` : ''}<script>${COMMENT_SCRIPT}</script></head><body class="${options.menu === 'open' ? 'primary-nav-expanded course-menu-expanded' : 'primary-nav-expanded'}">
<div id="application" class="ic-app"><div id="wrapper" class="ic-Layout-wrapper"><div id="main" class="ic-Layout-columns">
<div class="ic-Layout-watermark" aria-hidden="true"></div><div id="left-side" class="ic-app-course-menu"${options.menu === 'open' ? '' : ' style="display: none"'}><div id="sticky-container" class="ic-sticky-frame"><ul id="section-tabs"><li><a href="/courses/${course}" class="home">Home</a></li><li><a href="/courses/${course}/assignments" class="assignments active">Assignments</a></li></ul></div></div>
<div id="not_right_side" class="ic-app-main-content"><div id="content-wrapper" class="ic-Layout-contentWrapper"><div id="content" class="ic-Layout-contentMain" role="main">
  <div class="submission-details-header submission_details">
    <div class="submission-details-header__heading-and-grades">
      <h1 class="submission-details-header__heading submission_header">Submission Details</h1>
      <div class="submission-details-header__grade-summary">
        <div class="grade-values">Grade: <strong>40</strong> / 50</div>
        ${options.rubric && !options.rubricWithoutLink ? rubricLink(options.rubricUnread === true) : ''}
      </div>
    </div>
    <div class="ic-Action-header">
      <div class="ic-Action-header__Primary">
        <h2 class="submission-details-header__heading h3">Reflection Paper #1 Social impact analysis: impact on diversity, equality, and structural inequality</h2>
        <div class="submission-details-header__info"><div><span class="submission-details-header__time">Bao Tran submitted Sep 13 at 9:30pm</span></div></div>
      </div>
      <div class="ic-Action-header__Secondary ic-Action-header__Secondary--auto">${action}</div>
    </div>
  </div>
  ${hasHolder ? RUBRIC_HOLDER : ''}
  <div style="display: none;"><a style="display: none;" title="PUT" href="${page}" class="update_submission_url">&nbsp;</a></div>
  <div class="submission-details-container">
    <div class="submission-details-frame">
      <div id="asset_report_modal"></div>
      <iframe id="preview_frame" src="${src}" allowfullscreen="true" frameborder="0" style="border: 0; width: 100%; height: 300px; display: block;" title="Preview"></iframe>
    </div>
    <div class="submission-details-comments" style="word-wrap: break-word; min-width: 1%;">
      <div style="background-color: #fff; height: 100%">
        <a href="#" class="comments_link" style="display: none;">Comments</a>
        <div class="comments" style="height: 100%">
          <button type="button" class="btn button-secondary cancel_comment_button" style="display: none; float: right; margin-right:0 !important;">Delete</button>
          <div class="comment_list" aria-live="polite" style="padding: 10px; clear:right;">
            ${
              options.noComments
                ? ''
                : `<div class="comment" id="submission_comment_201" style="margin-bottom: 10px;">
              <div class="comment" style="color: #444;"><span class="comment_content" style="white-space: pre-wrap;">You selected an interesting and ambitious topic and found useful evidence about labor conditions within the anime industry.</span></div>
              <div class="comment_attachments" style="text-align: right; margin-right: 10px;"></div>
              <div class="comment_author_and_date" style="text-align: right; font-size: 0.8em;"><span class="author_name">Teacher</span>, <span class="posted_at">Sep 20 at 10:00am</span></div>
            </div>`
            }
          </div>
          <div class="comment" id="comment_blank" style="display: none; margin-bottom: 10px;">
            <span class="comment" style="color: #444; white-space: pre-wrap;"></span>
            <div class="comment_attachments" style="text-align: right; margin-right: 10px;"></div>
            <div style="text-align: right; font-size: 0.8em; color: #888;">
              <span class="author_name">&nbsp;</span>,
              <span class="posted_at">&nbsp;</span>
            </div>
          </div>
          <div style="padding: 10px;${options.noCommentForm ? ' display: none;' : ''}" id="add_comment_form">
            <label class="add_a_comment">
              <strong>Add a Comment:</strong>
              <div id="textarea-container">
                <textarea class="ic-Input grading_comment"></textarea>
                <span id="emoji-picker-container"></span>
              </div>
              <div id="textarea-error-container"></div>
              <div id="emoji-quick-picker-container"></div>
            </label>
            <div class="comment_attachments"></div>
            <div class="clearfix" style="text-align: right;">
              <a href="#" class="media_comment_link media-comment pull-left">Media Comment</a>
              <a href="#" style="float: right;" class="attach_comment_file_link">Attach File</a>
              <div class="clear"></div>
            </div>
            <div class="button-container">
              <button type="button" class="Button Button--primary save_comment_button">Save</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div></div>
<div id="right-side-wrapper" class="ic-app-main-content__secondary"><aside id="right-side"></aside></div>
</div></div></div></div><div id="aria_alerts" class="hide-text affix" role="alert" aria-live="assertive"></div></body></html>`;
}

/** The files frame with file rows. */
export function previewWithFiles(
  course: string,
  assignment: string,
  user: string,
  rows: readonly FrameRow[],
): string {
  const page = `/courses/${course}/assignments/${assignment}/submissions/${user}`;
  return previewDocument(frameRows(page, rows));
}

/** The files frame of a text entry (`#submission_preview.paper.user_content`). */
export function previewWithText(html: string): string {
  return previewDocument(
    `<div style="text-align: right; margin-top: 15px;"><select class="data_view"><option value="paper">Paper View</option></select></div><div id="submission_preview" class="paper user_content" role="document">${html}</div>`,
  );
}

/** The files frame of a student who handed in nothing. */
export function previewWithNothing(): string {
  return previewDocument(
    '<div style="margin: 20px auto; width: 200px; height: 50px; font-size: 1.5em; font-weight: bold;">No Submission</div>',
  );
}

/** The files frame of a media recording (`submission_type == 'media_recording'`). */
export function previewWithMedia(): string {
  return previewDocument(
    `<div><a href="#" class="play_media_recording_link" data-media_comment_id="m-1" data-media_comment_type="video">This submission is a media recording. click here to view.</a></div><div style="width: 400px; margin: 10px auto;" id="media_recording_box"><div id="box_content" class="box_content"></div></div><div class="media_comment_id" style="display: none;">m-1</div>`,
  );
}

function previewDocument(body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Preview</title><style>body{margin:0;font-family:Lato,Arial,sans-serif;font-size:14px}.file-upload-submission-table{width:100%;border-collapse:collapse}.file-upload-submission-table th,.file-upload-submission-table td{padding:8px;text-align:left;border-bottom:1px solid #e8eaec}.modal_preview_link{color:#0e68b3}</style></head><body>${body}</body></html>`;
}
