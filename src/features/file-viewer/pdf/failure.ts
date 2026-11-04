/** Privacy-safe diagnostics for PDF failures. */
import {
  safeContentType,
  FileBytesError,
  type AnswerFacts,
  type FileReadFacts,
} from '../../../shared/canvas/fileBytes';
import { t } from '../../../shared/ui/i18n';
import { REFUSED_MESSAGE, REFUSED_NAME } from './repairGuard';

const pick = <T extends string>(allowed: readonly T[], value: unknown, otherwise: string) =>
  allowed.find((item) => item === value) ?? otherwise;

/** One answer as `redirected`, `origin class` and `content type` text. Nothing measured is "unknown". */
function answerText(facts: AnswerFacts | undefined): [string, string, string] {
  if (!facts) return ['unknown', 'unknown', 'unknown'];
  return [
    facts.redirected === true || facts.redirected === false ? String(facts.redirected) : 'unknown',
    pick(['canvas', 'other', 'none'], facts.originClass, 'none'),
    typeof facts.contentType === 'string' ? safeContentType(facts.contentType) : 'unknown',
  ];
}

/** The report lines about the read. They never hold an address, a host, a query or a token. */
function readFactLines(facts: FileReadFacts | undefined): string {
  const [redirected, origin, type] = answerText(facts);
  const lines = [
    `Redirected: ${redirected}`,
    `Final origin class: ${origin}`,
    `Content type: ${type}`,
    `Read context: ${pick(['pane', 'background'], facts?.context, 'unknown')}`,
    `Background retry: ${pick(['not_run', 'failed', 'succeeded'], facts?.backgroundRetry, 'unknown')}`,
  ];
  if (facts?.retry) {
    const [again, againOrigin, againType] = answerText(facts.retry);
    lines.push(
      `Background answer: redirected ${again}, origin class ${againOrigin}, content type ${againType}`,
    );
  }
  return lines.join('\n');
}

export type PdfStage = 'fetch' | 'worker start' | 'document load' | 'page render' | 'page layers';
const messages = [
  'Invalid PDF structure.',
  'The document has too many pages',
  'Failed to fetch',
  'NetworkError when attempting to fetch resource.',
  REFUSED_MESSAGE,
];
const names = [
  'Error',
  'TypeError',
  'NetworkError',
  'SecurityError',
  'NotAllowedError',
  'UnknownErrorException',
  'InvalidPDFException',
  'MissingPDFException',
  'UnexpectedResponseException',
  'PasswordException',
  'AbortException',
  'FormatError',
  'RangeError',
  'InternalError',
  'DataCloneError',
  'FileBytesError',
  REFUSED_NAME,
];
/** The errors of a file whose bytes cannot be shown, so reading them again cannot help. */
const DAMAGED = ['InvalidPDFException', 'FormatError', 'MissingPDFException', REFUSED_NAME];

/** Keeps only diagnostic vocabulary after removing private spans, before truncation. */
export function messageShape(message: string): string {
  // The cut comes first, so the rules below never run on a long input. A word that the cut splits
  // is not in the word list, so it is removed.
  let decoded = message.slice(0, 500);
  for (let i = 0; i < 3; i++) {
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      break;
    }
  }
  return decoded
    .replace(/(["'`]).*?\1/gs, '[removed]')
    .replace(
      /(?:[a-z][a-z0-9+.-]*:\/\/|(?:data|blob|mailto|moz-extension|chrome-extension):|www\.|[/\\])\S*/gi,
      '[removed]',
    )
    .replace(/[a-z0-9+/_=-]{16,}/gi, '[removed]')
    .replace(/[\p{L}\p{N}_@.%+=-]+/gu, (word) =>
      /^(removed|Invalid|PDF|structure|The|document|has|too|many|pages|Failed|to|fetch|NetworkError|when|attempting|resource|error|Error|Missing|header|offset|stream|object|font|image|canvas|worker|failed|start|is|not|null|undefined|of|cannot|read|properties|access|property|was|terminated|out|memory|defined|setting|up|fake|loading|module|operation|insecure|TypeError|RangeError|SecurityError|InternalError|DataCloneError|recursion|unknown|context|getContext|could|be|cloned|denied|allowed|blocked|script|load|unexpected|response|password|exception|abort|aborted|the|a|an|in|on|for|with|by|at|from|and|or|no|NaN|this)$/i.test(
        word.replace(/\.$/, ''),
      )
        ? word
        : '[removed]',
    )
    .slice(0, 80);
}

export function sanitizePdfError(error: unknown): { name: string; message: string } {
  const value = error as { name?: unknown; message?: unknown } | null;
  return {
    name: typeof value?.name === 'string' && names.includes(value.name) ? value.name : 'Error',
    message:
      typeof value?.message === 'string' && messages.includes(value.message)
        ? value.message
        : '[message removed for privacy]',
  };
}

export function pdfDetails(
  error: unknown,
  stage: PdfStage,
  bytes: number,
  version: string,
  agent: string,
  readFacts?: FileReadFacts,
): { reason: string; report: string; retry: boolean } {
  const safe = sanitizePdfError(error);
  const file = error instanceof FileBytesError ? error : null;
  const status =
    file?.status !== undefined &&
    Number.isInteger(file.status) &&
    file.status >= 100 &&
    file.status <= 599
      ? file.status
      : undefined;
  const kind =
    file &&
    [
      'origin_blocked',
      'too_large',
      'status',
      'not_a_file',
      'network',
      'aborted',
      'unconfirmed',
    ].includes(file.kind)
      ? file.kind
      : undefined;
  const responseFacts = readFactLines(file?.facts ?? readFacts);
  const tooMany = safe.message === 'The document has too many pages';
  const reason =
    kind === 'status'
      ? t('pdfHttpError', String(status ?? 'unknown'))
      : kind === 'not_a_file'
        ? t('pdfSignInPage')
        : kind === 'origin_blocked'
          ? t('pdfOriginBlocked')
          : kind === 'unconfirmed'
            ? t('pdfUnconfirmed')
            : kind === 'too_large'
              ? t('pdfTooLarge')
              : safe.name === 'PasswordException'
                ? t('pdfPasswordReason')
                : tooMany
                  ? t('pdfTooManyPages')
                  : DAMAGED.includes(safe.name)
                    ? t('pdfDamaged')
                    : safe.name === 'SecurityError' && stage === 'page render'
                      ? t('pdfDrawingBlocked')
                      : stage === 'worker start'
                        ? t('pdfEngineStartError')
                        : safe.name === 'SecurityError' && stage === 'fetch'
                          ? t('pdfFetchBlocked')
                          : stage === 'fetch'
                            ? t('pdfNetworkError')
                            : t('pdfEngineError');
  const shape = messageShape(String((error as { message?: unknown } | null)?.message ?? ''));
  return {
    reason,
    // A read that fails for any reason offers Retry (decision 25), except where reading the same
    // bytes again cannot help.
    retry:
      kind !== 'too_large' &&
      safe.name !== 'PasswordException' &&
      !tooMany &&
      !DAMAGED.includes(safe.name),
    report: `Extension version: ${version}\nUser agent: ${agent}\nError name: ${safe.name}\nError message: ${safe.message}\nMessage shape: ${shape}\nFile error kind: ${kind ?? 'none'}\nHTTP status: ${status ?? 'none'}\n${responseFacts}\nStage: ${stage}\nByte length: ${bytes}\nPDF.js version: 6.5.438\nOffscreenCanvas: ${typeof OffscreenCanvas !== 'undefined'}\nImageDecoder: ${'ImageDecoder' in globalThis}\nWebAssembly: ${typeof WebAssembly !== 'undefined'}\nModule workers: ${moduleWorkers()}`,
  };
}

/** Reads the module option without starting a worker or making a request. */
function moduleWorkers(): boolean {
  if (typeof Worker === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
  let supported = false;
  const url = URL.createObjectURL(new Blob([''], { type: 'text/javascript' }));
  try {
    const worker = new Worker(url, {
      get type() {
        supported = true;
        return 'module' as const;
      },
    });
    worker.terminate();
  } catch {
    /* A policy can block worker creation after the option is read. */
  } finally {
    URL.revokeObjectURL(url);
  }
  return supported;
}
