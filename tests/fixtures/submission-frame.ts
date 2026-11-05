/**
 * The files frame of the Submission Details page as Canvas draws it
 * (`app/views/submissions/show_preview.html.erb` of canvas-lms 1c9f0bb, `online_upload` branch).
 */

export interface FrameRow {
  fileId: string;
  name: string;
  /** Canvas's size text, from `number_to_human_size`. */
  size: string;
  /** The label of the preview button, or `null` when Canvas draws none. */
  button: 'View Feedback' | 'Preview' | null;
  unread?: boolean;
  /** The classes of the button, when Canvas renamed them. */
  buttonClass?: string;
  /** The value of `data-canvadoc_session_url`. */
  session?: string;
  /** What Canvas draws in the originality cell: a Turnitin or VeriCite score and report link. */
  score?: string;
  /** What the script of Canvas draws in the report status cell, a moment after the load. */
  report?: string;
}

/** A signed session path as `Attachment#canvadoc_url` builds it. */
export const SESSION_PATH = '/api/v1/canvadoc_session?blob=%7B%22attachment_id%22%3A501%7D';

export function frameRows(path: string, rows: readonly FrameRow[]): string {
  const body = rows
    .map(
      (row) => `
        <tr class="file-upload-submission">
          <td class="file-upload-submission-info">
            <a href="${path}?download=${row.fileId}" class="file-upload-submission-info__link">
              ${row.name}
            </a>
            <span class="file-upload-submission-info__filesize">${row.size}</span>
          </td>
          <td class="file-upload-submission-turnitin">${row.score ?? ''}</td>
          <td class="asset-report-status-container" data-attachment-id="${row.fileId}" data-submission-id="9" data-submission-type="online_upload">${row.report ?? ''}</td>
          <td class="file-upload-submission-attachment">${
            row.button === null
              ? ''
              : `<a href=${path}?download=${row.fileId} data-tooltip title="Preview your submission" class="${row.buttonClass ?? 'modal_preview_link Button--link'}" role="button" data-attachment_id="${row.fileId}" data-submission_id="9" data-dialog-title="${row.name}" data-canvadoc_session_url="${row.session ?? SESSION_PATH}" data-attachment_name="${row.name}" data-attachment_id="${row.fileId}">${row.button}</a>${
                  row.unread === true
                    ? '<span class="submission_annotation unread_indicator" aria-hidden="true"></span>'
                    : ''
                }`
          }</td>
        </tr>`,
    )
    .join('');
  return `<table class="file-upload-submission-table">
      <thead><tr><th class="file-info-header">Files</th><th></th><th></th><th></th></tr></thead>
      <tbody>${body}</tbody></table>`;
}

/** The page that Canvas writes into the report addresses of the fixtures. */
const REPORT_PAGE = '/courses/12/assignments/101/submissions/42';

/**
 * The originality cell of a file row in every form that `_originality_score.html.erb` and
 * `_originality_score_icon.html.erb` of canvas-lms 1c9f0bb draw. `page` is the Submission Details
 * path that the report addresses start with.
 */
export function turnitinScores(page: string = REPORT_PAGE) {
  const classic = (state: string, text: string, href: string, title: string) =>
    `<span class="turnitin_score_container"><span class="turnitin_score_container_caret ${state}_score"></span><a href="${href}" target="_blank" title="${title}" class="not_external turnitin_similarity_score ${state}_score">${text}</a></span>`;
  return {
    /** The classic form of a report that has no originality report record. */
    legacy: classic(
      'acceptable',
      '5.0%',
      `${page}/turnitin/attachment_1`,
      'Similarity score -- more information',
    ),
    /** The classic form of an originality report, with the attempt in the address. */
    legacyReport: `<span class="turnitin_score_container"><span class="turnitin_score_container_caret warning_score"></span>
            <a href="${page}/originality_report/attachment_1?attempt=2" target="_blank" title="Similarity score" class="not_external turnitin_similarity_score warning_score" data-tooltip="left">
              23.0%
            </a></span>`,
    /** A report that is not ready: the link has a title and a blank body. */
    legacyPending: `<span class="turnitin_score_container"><span class="turnitin_score_container_caret pending_score"></span>
            <a href="${page}/originality_report/attachment_1?attempt=2" target="_blank" title="Similarity score" class="not_external turnitin_similarity_score pending_score" data-tooltip="left"> </a></span>`,
    /** A report with an error: the link has the message as its title and an image. */
    legacyError: `<span class="turnitin_score_container"><span class="turnitin_score_container_caret error_score"></span>
            <a title="The file type is not supported" href="${page}/originality_report/attachment_1?attempt=2" data-tooltip="left" target="_blank">
              <img src="/images/turnitin_error_score.png" alt="The file type is not supported">
            </a></span>`,
    /** The VeriCite form, with its tooltip inside the link. */
    vericite: `<span class="turnitin_score_container">
      <span class="vericite_score_container_caret acceptable_score"></span>
      <a href="${page}/vericite/attachment_1"target="_blank" title="Similarity score -- more information" class="tooltip not_external turnitin_similarity_score acceptable_score">
      5%
      <span class="tooltip_wrap right">
          <span class="tooltip_text">See VeriCite results</span>
      </span>
      </a>
    </span>`,
    /** The updated form with an address: an icon and the score in the link. */
    updated: `<a class="turnitin_score_container tooltip" href="${page}/originality_report/attachment_1?attempt=2" title="Similarity score"><i class="icon-certified icon-Solid"></i>
    <span class="turnitin_similarity_score">5.0%</span></a>`,
    /** The updated form of a pending report that has no address: a span with a clock icon. */
    updatedNoAddress: `<span class="turnitin_score_container tooltip"><i class="icon-clock"></i>
    <span class="turnitin_similarity_score">7.0%</span></span>`,
  };
}

/** A Turnitin score of the classic form, as the mockup shows it: 5.0%, acceptable. */
export const TURNITIN_SCORE = turnitinScores().legacy;
