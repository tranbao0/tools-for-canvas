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
export const SESSION_PATH =
  '/api/v1/canvadoc_session?blob=%7B%22attachment_id%22%3A501%7D&hmac=abc123';

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

/** A Turnitin score as `_originality_score.html.erb` draws it, in the classic icon form. */
export const TURNITIN_SCORE =
  '<span class="turnitin_score_container"><span class="turnitin_score_container_caret warning_score"></span><a href="/courses/12/assignments/101/submissions/42/turnitin/attachment_1" target="_blank" title="Similarity score -- more information" class="not_external turnitin_similarity_score warning_score">23%</a></span>';
