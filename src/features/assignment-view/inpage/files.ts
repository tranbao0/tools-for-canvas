/**
 * The files of the Submission box, built from the details that the background reads (design
 * decision 26, item 5). Nothing here reads the page: the name, the size, the score and the session
 * address of a file come from the Canvas records, and the files frame only refines two marks.
 *
 * The score follows `app/views/submissions/_originality_score.html.erb`: a VeriCite score comes
 * first, and a Turnitin or originality report score otherwise. The data of an attachment comes
 * first, and the data of the whole submission is the fallback, as in the template.
 */
import { normalizeCanvasId } from '../../../shared/canvas/ids';
import type { AssignmentFile, AssignmentReport, SubmissionReports } from '../protocol';

/** The path of the session that Canvas gives for a previewable file (`Attachment#canvadoc_url`). */
const SESSION_PATH = '/api/v1/canvadoc_session';
/**
 * The query of a session: `blob`, with `hmac` when Canvas sends one, once each and with a value, and
 * no other parameter. A live Canvas sends the blob alone.
 */
const SESSION_QUERY = /^\?(?:blob=[^&]+(?:&hmac=[^&]+)?|hmac=[^&]+&blob=[^&]+)$/;

/** The label of the feedback button when the frame gives none. */
const DEFAULT_LABEL = 'View Feedback';

/** The similarity score of a file, as the box shows it. */
export interface FileReport {
  /** The score text, such as "5.0%", or the error message, or "Similarity score". */
  text: string;
  /** The color class of the score: `none`, `acceptable`, `warning`, `problem`, `failure`, `pending` or `error`. */
  state: string | null;
  /** The checked address of the report. */
  url: string;
}

export interface BoxFile {
  fileId: string;
  name: string;
  /** The size text, such as "118 KB". */
  size: string | null;
  /** The label of the feedback button, or `null` when the file has no button. */
  feedbackLabel: string | null;
  /** Whether Canvas marks unread comments on the file. */
  unread: boolean;
  /** The checked address of the session. It is never put on the page. */
  sessionUrl: string | null;
  /** The similarity score of the file, or `null` when it has none. */
  report: FileReport | null;
}

/**
 * The address of a DocViewer session, or `null`. It must be on the saved Canvas, with the session
 * path and the signed parameter `blob`, an optional `hmac`, once each, and no other parameter, and
 * no credentials. The value is signed for one student, so no other address is ever used.
 */
export function sessionUrl(value: string | null | undefined, origin: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  try {
    const url = new URL(value, origin);
    if (
      url.origin !== origin ||
      url.username !== '' ||
      url.password !== '' ||
      url.pathname !== SESSION_PATH ||
      url.hash !== ''
    )
      return null;
    // The query is read as text, because a Firefox content script cannot iterate its parameters.
    return SESSION_QUERY.test(url.search) ? url.href : null;
  } catch {
    return null;
  }
}

/** `/courses/:c/assignments/:a/submissions/:user`, each id plain or with a shard. */
const SUBMISSION_PATH =
  /^\/courses\/(\d+(?:~\d+)?)\/assignments\/(\d+(?:~\d+)?)\/submissions\/(\d+(?:~\d+)?)\/?$/;

/**
 * Whether two paths are the Submission Details page of the same course, assignment and user. The
 * page can write an id as `2~123` while the frame writes it as `20000000000123`, so the ids are
 * compared segment by segment as decimal global ids.
 */
export function sameSubmissionPath(a: string, b: string): boolean {
  const first = SUBMISSION_PATH.exec(a);
  const second = SUBMISSION_PATH.exec(b);
  if (!first || !second) return false;
  return [1, 2, 3].every((index) => {
    return normalizeCanvasId(first[index]!) === normalizeCanvasId(second[index]!);
  });
}

/** The path of a report: `turnitin`, `vericite` or `originality_report` and an asset string. */
const REPORT_PATH =
  /^(\/courses\/\d+(?:~\d+)?\/assignments\/\d+(?:~\d+)?\/submissions\/\d+(?:~\d+)?)\/(?:turnitin|vericite|originality_report)\/[A-Za-z0-9_~-]+$/;
/** The query of a report address: none, or the attempt. */
const REPORT_QUERY = /^(?:\?attempt=\d+)?$/;

/**
 * The address of a similarity report, or `null`. It must be on the saved Canvas, with no hash and
 * no credentials, on one of the three report routes of the submission of this page
 * (`config/routes.rb`), and with no query but the attempt.
 */
export function reportUrl(value: string, origin: string, pagePath: string): string | null {
  if (value.includes('#')) return null;
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || url.username !== '' || url.password !== '') return null;
    const route = REPORT_PATH.exec(url.pathname);
    if (!route || !sameSubmissionPath(route[1]!, pagePath)) return null;
    // The query is read as text, because a Firefox content script cannot iterate its parameters.
    return REPORT_QUERY.test(url.search) ? url.href : null;
  } catch {
    return null;
  }
}

/** A size as Rails `number_to_human_size` writes it, for example "118 KB". */
export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? 'Byte' : 'Bytes'}`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length);
  const value = Number((bytes / 1024 ** exponent).toPrecision(3));
  return `${value} ${units[exponent - 1]}`;
}

/** The score as the updated icon of Canvas writes it (`I18n.n(score, precision: 1)`): "5.0%". */
export function scoreText(score: number): string {
  return `${(Math.round(score * 10) / 10).toFixed(1)}%`;
}

const SCORE_STATES: ReadonlySet<string> = new Set([
  'none',
  'acceptable',
  'warning',
  'problem',
  'failure',
  'pending',
  'error',
]);
const MAX_REPORT_TEXT = 40;

export interface ReportContext {
  origin: string;
  /** The path of the submission: `/courses/:c/assignments/:a/submissions/:user`. */
  pagePath: string;
}

export interface ReportResult {
  report: FileReport | null;
  /** False when the report data of the subject has a form that the view cannot show. */
  readable: boolean;
}

/** The asset strings of a file: `attachment_` and its id, and its local id on another shard. */
function attachmentAssets(fileId: string): string[] {
  const local = fileId.split('~')[1];
  return local === undefined
    ? [`attachment_${fileId}`]
    : [`attachment_${fileId}`, `attachment_${local}`];
}

/**
 * The keys that hold a report of the submission itself: the key with the time of the submission
 * after `submission_<id>` (`OriginalityReport.submission_asset_key`), and, for a text entry only,
 * the plain `submission_<id>`. Canvas writes that time as `utc.iso8601`, and the record writes
 * `submitted_at` in its own form, so the two compare as instants and not as text. With no time to
 * compare, every key with a time counts. A file row never takes the plain key, which belongs to a
 * text entry.
 */
function submissionAssets(source: SubmissionReports, text: boolean): string[] {
  if (source.id === undefined) return [];
  const plain = `submission_${source.id}`;
  const at = source.submitted_at ? Date.parse(source.submitted_at) : Number.NaN;
  const reports = Array.isArray(source.reports) ? source.reports : [];
  const timed = reports
    .map((entry) => entry.asset)
    .filter(
      (asset) =>
        asset.startsWith(`${plain}_`) &&
        (Number.isNaN(at) || Date.parse(asset.slice(plain.length + 1)) === at),
    );
  return text ? [...timed, plain] : timed;
}

/** The score element of an entry, or `null` when its address fails the check. */
function chip(
  entry: AssignmentReport,
  route: string,
  asset: string,
  attempt: number | null | undefined,
  context: ReportContext,
): FileReport | null {
  const state = entry.state !== null && SCORE_STATES.has(entry.state) ? entry.state : null;
  let text: string;
  let shown = state;
  if (entry.status === 'error' || state === 'error') {
    text = (entry.error ?? '').slice(0, MAX_REPORT_TEXT).trim() || 'Similarity report';
    shown = 'error';
  } else if (entry.score !== null) {
    text = scoreText(entry.score);
  } else {
    text = 'Similarity score';
    shown = 'pending';
  }
  const page = context.pagePath.replace(/\/$/, '');
  const query =
    route === 'originality_report' &&
    typeof attempt === 'number' &&
    Number.isInteger(attempt) &&
    attempt >= 0
      ? `?attempt=${attempt}`
      : '';
  const url = reportUrl(`${page}/${route}/${asset}${query}`, context.origin, context.pagePath);
  return url === null ? null : { text, state: shown, url };
}

/** Whether an entry has something to show: a score, a report that is not ready, or an error. */
function showable(entry: AssignmentReport): boolean {
  return (
    entry.score !== null ||
    entry.state === 'pending' ||
    entry.status === 'pending' ||
    entry.state === 'error' ||
    entry.status === 'error'
  );
}

/**
 * The score that the template shows for a subject. `own` holds the asset strings of the subject
 * (an attachment), `whole` the keys of the submission, which the template falls back to, and
 * `asset` names the subject in the report address. A subject whose selected entry cannot be shown
 * gives `readable: false`, and no score.
 */
export function reportFor(
  source: SubmissionReports,
  own: readonly string[],
  whole: readonly string[],
  asset: string,
  context: ReportContext,
): ReportResult {
  const reports = Array.isArray(source.reports) ? source.reports : [];
  const first = (list: readonly string[], vericite: boolean): AssignmentReport | undefined => {
    for (const key of list) {
      const hit = reports.find(
        (entry) => entry.asset === key && (entry.kind === 'vericite') === vericite,
      );
      if (hit) return hit;
    }
    return undefined;
  };
  // The template looks up `vericite_data[attachment]`, then `originality_data[submission]`.
  const vericite = reports.some((entry) => entry.kind === 'vericite')
    ? (first(own, true) ?? first(whole, false))
    : undefined;
  const entry = first(own, false) ?? first(whole, false);
  // Only the entries that the lookup selects count: an entry that the template never uses is no
  // reason to hide the score of another.
  if ((vericite !== undefined && !vericite.readable) || (entry !== undefined && !entry.readable))
    return { report: null, readable: false };
  if (vericite !== undefined && vericite.score !== null) {
    const result = chip(vericite, 'vericite', asset, source.attempt, context);
    return result === null ? { report: null, readable: false } : { report: result, readable: true };
  }
  if (entry === undefined || !showable(entry)) return { report: null, readable: true };
  const result = chip(entry, entry.kind, asset, source.attempt, context);
  return result === null ? { report: null, readable: false } : { report: result, readable: true };
}

/** The score of one file of the submission record. */
export function fileReport(
  source: SubmissionReports,
  fileId: string,
  context: ReportContext,
): ReportResult {
  const assets = attachmentAssets(fileId);
  return reportFor(source, assets, submissionAssets(source, false), assets[0]!, context);
}

export interface BoxFiles {
  files: BoxFile[];
  /** False when the report data of a file cannot be shown. */
  readable: boolean;
  /** How many files have a session address that fails the check, so they get no feedback button. */
  withoutSession: number;
}

/** The files of an upload, from the attachments and the report data of the submission record. */
export function filesFromDetails(
  attachments: readonly AssignmentFile[],
  source: SubmissionReports,
  context: ReportContext,
): BoxFiles {
  const files: BoxFile[] = [];
  let readable = true;
  let withoutSession = 0;
  for (const file of attachments) {
    const { report, readable: shown } = fileReport(source, file.id, context);
    if (!shown) readable = false;
    const session = sessionUrl(file.preview_url, context.origin);
    if (file.preview_url !== undefined && session === null) withoutSession += 1;
    files.push({
      fileId: file.id,
      name: file.display_name,
      size: file.size === undefined ? null : humanSize(file.size),
      feedbackLabel: session === null ? null : DEFAULT_LABEL,
      unread: false,
      sessionUrl: session,
      report,
    });
  }
  return { files, readable, withoutSession };
}

/** The score of the submission itself, which a text entry has. */
export function submissionReport(source: SubmissionReports, context: ReportContext): ReportResult {
  const whole = submissionAssets(source, true);
  if (whole.length === 0) return { report: null, readable: true };
  return reportFor(source, [], whole, `submission_${source.id}`, context);
}

/** What the files frame says about a file whose row has a preview button. */
export interface FrameHint {
  /** The text of the button in the language of Canvas, or `null` when it has none that fits. */
  label: string | null;
  /** Whether Canvas draws its unread mark in the row. */
  unread: boolean;
  /** The checked session address of the button, or `null`. It is never put on the page. */
  session: string | null;
}

export interface RefinedFiles {
  files: BoxFile[];
  /** How many files the frame shows a button for, while no checked session address is known. */
  withoutSession: number;
}

/**
 * The files with what the frame says about them, for the files that it names. The label and the
 * unread mark come from the frame. The session address comes from the details, and the address of
 * the frame row is the second source for a file that has none. A file that the frame shows a
 * button for and that has no address from either source is counted, because Canvas's button for
 * it cannot be drawn by the view.
 */
export function refineFiles(
  files: readonly BoxFile[],
  hints: ReadonlyMap<string, FrameHint>,
): RefinedFiles {
  let withoutSession = 0;
  const refined = files.map((file) => {
    const hint = hints.get(normalizeCanvasId(file.fileId));
    if (hint === undefined) return file;
    const session = file.sessionUrl ?? hint.session;
    if (session === null) {
      withoutSession += 1;
      return file;
    }
    return {
      ...file,
      feedbackLabel: hint.label ?? file.feedbackLabel ?? DEFAULT_LABEL,
      unread: hint.unread,
      sessionUrl: session,
    };
  });
  return { files: refined, withoutSession };
}

/** Whether two lists show the same files, so the view draws nothing again. */
export function sameFiles(a: readonly BoxFile[], b: readonly BoxFile[]): boolean {
  return (
    a.length === b.length &&
    a.every((file, index) => {
      const other = b[index]!;
      return (
        file.fileId === other.fileId &&
        file.name === other.name &&
        file.size === other.size &&
        file.feedbackLabel === other.feedbackLabel &&
        file.unread === other.unread &&
        file.sessionUrl === other.sessionUrl &&
        file.report?.text === other.report?.text &&
        file.report?.state === other.report?.state &&
        file.report?.url === other.report?.url &&
        (file.report === null) === (other.report === null)
      );
    })
  );
}
