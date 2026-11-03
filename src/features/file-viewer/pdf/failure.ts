/** Privacy-safe diagnostics for PDF failures. Unknown messages are removed in full. */
export type PdfStage = 'fetch' | 'worker start' | 'document load' | 'page render';
const messages = [
  'Invalid PDF structure.',
  'The document has too many pages',
  'Failed to fetch',
  'NetworkError when attempting to fetch resource.',
];
const names = [
  'Error',
  'TypeError',
  'NetworkError',
  'SecurityError',
  'NotAllowedError',
  'InvalidPDFException',
  'FormatError',
  'MissingPDFException',
  'PasswordException',
  'FileBytesError',
];

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
): { reason: string; report: string } {
  const safe = sanitizePdfError(error);
  const reason =
    safe.name === 'SecurityError' || safe.name === 'NotAllowedError'
      ? 'Drawing blocked by a browser privacy setting'
      : safe.name === 'InvalidPDFException' ||
          safe.name === 'FormatError' ||
          safe.name === 'MissingPDFException'
        ? 'This PDF is damaged'
        : stage === 'fetch'
          ? 'Network error'
          : stage === 'worker start'
            ? 'PDF engine failed to start'
            : 'PDF engine failed';
  return {
    reason,
    report: `Extension version: ${version}\nUser agent: ${agent}\nError name: ${safe.name}\nError message: ${safe.message}\nStage: ${stage}\nByte length: ${bytes}`,
  };
}
