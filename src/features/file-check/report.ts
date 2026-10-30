/**
 * The plain-text report of the file access check. The tester pastes it into a bug report, so
 * it holds hosts, redacted paths, counts, statuses and media types, and nothing else. A last
 * pass removes what should not be there even if an earlier step let it through.
 */
import type { FileHop, FileProbeResult } from '../../shared/canvas/fileFetch';
import { scrubReport } from '../../shared/canvas/redact';
import type {
  ApiResult,
  CheckResults,
  FrameResult,
  HeadResult,
  ReportEnvironment,
  ScanSummary,
} from './types';

const KIND_LABELS = {
  instructure_file_link: 'a.instructure_file_link',
  files_href: 'a[href*="/files/"]',
  preview_button: 'preview buttons',
  module_file_item: 'module file items',
  submission_attachment: 'submission attachment links',
} as const;

function yesNo(value: boolean | null): string {
  return value === null ? 'not run' : value ? 'yes' : 'no';
}

function scanLines(scan: ScanSummary): string[] {
  const lines = [`Page: ${scan.pagePath}`];
  for (const kind of scan.kinds) {
    const sample = kind.sample === null ? 'no sample path' : `sample ${kind.sample}`;
    lines.push(`${KIND_LABELS[kind.kind]}: ${kind.count} found, ${sample}`);
    for (const hook of kind.hooks) lines.push(`  hook: ${hook}`);
  }
  return lines;
}

function apiLines(api: ApiResult): string[] {
  const lines = [
    `GET /api/v1/files/:id: ${api.status === null ? 'no answer' : `status ${api.status}`}${api.error === null ? '' : ` (${api.error})`}`,
    `  response content-type: ${api.contentType ?? 'none'}`,
    `  size: ${api.size ?? 'none'}`,
    `  file content-type: ${api.fileContentType ?? 'none'}`,
  ];
  for (const [name, has, where] of [
    ['url', api.hasUrl, api.url],
    ['preview_url', api.hasPreviewUrl, api.previewUrl],
  ] as const) {
    const detail =
      where === null
        ? ''
        : ` (${where.host}${where.path === '/' ? '' : where.path}, ${where.sameOrigin ? 'same origin as Canvas' : 'another origin'})`;
    lines.push(`  ${name}: ${yesNo(has)}${detail}`);
  }
  return lines;
}

function hopLine(hop: FileHop, index: number): string {
  const status =
    hop.status === 0 && hop.kind === 'redirect' ? '0 (opaque redirect)' : String(hop.status);
  const path = hop.path === '/' ? '' : hop.path;
  return `  hop ${index + 1} (${hop.kind}): ${hop.host}${path}, status ${status}, content-type ${hop.contentType ?? 'none'}`;
}

function probeLines(title: string, probe: FileProbeResult | null): string[] {
  if (probe === null) return [`${title}: not run`];
  const lines = [`${title}:`, ...probe.hops.map(hopLine)];
  lines.push(
    `  redirected: ${yesNo(probe.redirected)}, response type: ${probe.responseType ?? 'none'}`,
  );
  lines.push(
    `  bytes read: ${probe.bytes ?? 'none'}${probe.truncated ? ' (stopped at the size limit)' : ''}`,
  );
  lines.push(`  first 5 bytes: ${probe.firstBytes ?? 'none'}`);
  lines.push(`  %PDF- signature: ${yesNo(probe.pdfSignature)}`);
  lines.push(`  fetch threw: ${probe.threw === null ? 'no' : `yes (${probe.threw})`}`);
  return lines;
}

function frameLines(frame: FrameResult | null): string[] {
  if (frame === null) return ['Probe page in an iframe: not run'];
  return [
    `Probe page in an iframe (${frame.scheme ?? 'no'} address): ${frame.handshake ? 'loaded, handshake answered' : 'NOT loaded, no handshake'}`,
    `  load event: ${yesNo(frame.loadEvent)}, dynamic address: ${yesNo(frame.dynamicAddress)}, time: ${frame.ms} ms${frame.error === null ? '' : `, error: ${frame.error}`}`,
  ];
}

function cspLines(scan: ScanSummary | null, head: HeadResult | null): string[] {
  const lines = [`Meta tag CSP: ${scan === null ? 'not run' : (scan.metaCsp ?? 'none')}`];
  if (head === null) return [...lines, 'HEAD of the page: not run'];
  lines.push(
    `HEAD ${head.path}: ${head.status === null ? 'no answer' : `status ${head.status}`}${head.error === null ? '' : ` (${head.error})`}`,
  );
  lines.push(`  content-security-policy: ${head.csp ?? 'none'}`);
  lines.push(`  content-security-policy-report-only: ${head.cspReportOnly ?? 'none'}`);
  return lines;
}

/** Builds the report text. */
export function buildReport(results: CheckResults, env: ReportEnvironment): string {
  const lines = [
    'File access check',
    `Date: ${env.date}`,
    `Browser: ${env.browser}`,
    `Extension version: ${env.extensionVersion}`,
    `Canvas host: ${env.canvasHost}`,
    '',
    '[Links and hooks on the page]',
    ...(results.scan === null
      ? [`not run${results.scanError === null ? '' : ` (${results.scanError})`}`]
      : scanLines(results.scan)),
    '',
    '[File API]',
    `File id source: ${results.fileSource ?? 'none'}`,
    ...(results.api === null ? ['not run'] : apiLines(results.api)),
    '',
    '[File bytes]',
    ...probeLines('From the background', results.background),
    ...probeLines('From an extension page', results.extensionPage),
    'Note: fetch shows the first answer and the last answer only. The hops between them are not visible.',
    '',
    '[Frame check]',
    ...frameLines(results.frame),
    '',
    '[Content security policy]',
    ...cspLines(results.scan, results.head),
  ];
  if (results.notes.length > 0) lines.push('', '[Notes]', ...results.notes);
  return scrubReport(lines.join('\n'));
}
