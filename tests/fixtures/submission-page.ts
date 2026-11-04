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
  /** The address of the files frame. */
  frameSrc?: string;
}

const CSS = readFileSync('tests/fixtures/pages/canvas-layout.css', 'utf8');

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
.submission-details-comments { box-sizing: border-box; flex: 0 0 280px; border-inline-start: 1px solid #e8eaec; background: #f5f5f5; font-size: 14px; }
.submission-details-comments .comments { height: 300px; overflow: auto; }
`;

/** The top page of a student's own submission, or of a teacher who looks at it. */
export function submissionDetailsPage(options: SubmissionPageOptions = {}): string {
  const course = options.course ?? '12';
  const assignment = options.assignment ?? '101';
  const user = options.user ?? '42';
  const page = `/courses/${course}/assignments/${assignment}/submissions/${user}`;
  const src = options.frameSrc ?? `${page}?preview=1&rand=481516`;
  const action = options.teacher
    ? `<a class="Button" href="/courses/${course}/gradebook/speed_grader?assignment_id=${assignment}&amp;student_id=${user}" target="_blank" rel="noopener"><i class="icon-speed-grader" aria-hidden="true"></i> SpeedGrader</a>`
    : `<a href="/courses/${course}/assignments/${assignment}#submit" class="Button Button--primary">Re-submit Assignment</a>`;
  return `<!doctype html>
<html lang="en" dir="ltr"><head><meta charset="utf-8"><title>Reflection Paper #1: Submission Details</title>
<style>${CSS}${STYLE}</style>
<script>INST = { environment: 'production' }; ENV = { current_user_id: '5501', SUBMISSION: { assignment_id: '${assignment}', user_id: '${user}' } };</script>
</head><body>
<div id="application" class="ic-app"><div id="content" class="ic-Layout-contentMain" role="main" style="max-width:1100px;margin:0 auto;padding:24px">
  <div class="submission-details-header submission_details">
    <div class="submission-details-header__heading-and-grades">
      <h1 class="submission-details-header__heading submission_header">Submission Details</h1>
      <div class="submission-details-header__grade-summary">
        <div class="grade-values">Grade: <strong>40</strong> / 50</div>
        <div class="submission-details-header__rubric"><a href="#" class="assess_submission_link Button Button--small Button--link" tabindex="0"><i class="icon-rubric" aria-hidden="true"></i>Show Rubric</a></div>
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
          <div class="comment_list" aria-live="polite" style="padding: 10px; clear: right;">
            <div class="comment" id="submission_comment_201" style="margin-bottom: 10px;">
              <div class="comment" style="color: #444;"><span class="comment_content" style="white-space: pre-wrap;">You selected an interesting and ambitious topic and found useful evidence about labor conditions within the anime industry.</span></div>
              <div class="comment_author_and_date" style="text-align: right; font-size: 0.8em;"><span class="author_name">Teacher</span>, <span class="posted_at">Sep 20 at 10:00am</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div></div></body></html>`;
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

function previewDocument(body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Preview</title><style>body{margin:0;font-family:Lato,Arial,sans-serif;font-size:14px}.file-upload-submission-table{width:100%;border-collapse:collapse}.file-upload-submission-table th,.file-upload-submission-table td{padding:8px;text-align:left;border-bottom:1px solid #e8eaec}.modal_preview_link{color:#0e68b3}</style></head><body>${body}</body></html>`;
}
