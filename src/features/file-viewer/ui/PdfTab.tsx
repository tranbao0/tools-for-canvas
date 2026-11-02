/**
 * The PDF of one tab (design decision 25): it reads the bytes with a progress bar, loads PDF.js,
 * and then shows the viewer. The tab starts when it first becomes the active tab. It keeps its
 * document and scroll position while the pane stays open, hidden when another tab is active.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { FileBytesError } from '../../../shared/canvas/fileBytes';
import { t } from '../../../shared/ui/i18n';
import { PdfViewer, type PdfFailure, type PdfSource } from '../pdf/PdfViewer';
import type { PdfjsLib } from '../pdf/types';
import type { PaneFile } from './FileCard';
import { formatSize } from './fileInfo';
import type { FileLinks } from './links';
import { PdfInfoLine } from './PdfHeader';

/** What a PDF tab needs from the extension. */
export interface PdfHost {
  /** Reads the bytes of a file address on the saved Canvas. */
  readFile(
    url: string,
    onProgress: (loaded: number, total: number | null) => void,
    signal: AbortSignal,
  ): Promise<Uint8Array>;
  /** Loads PDF.js. */
  loadPdfjs(): Promise<PdfjsLib>;
}

type Phase =
  | { kind: 'reading'; loaded: number; total: number | null }
  | { kind: 'viewer'; lib: PdfjsLib; source: PdfSource }
  | { kind: 'error'; failure: PdfFailure | 'read' | 'large' | 'unconfirmed' };

/** The part of the bytes read, from 0 to 1, or `null` when the length is not known. */
export function progressFraction(loaded: number, total: number | null): number | null {
  if (total === null || !Number.isFinite(total) || total <= 0) return null;
  // The length of a compressed answer can differ from the bytes read, so the value is clamped.
  return Math.min(1, Math.max(0, loaded / total));
}

function Progress(props: { loaded: number; total: number | null }) {
  const fraction = progressFraction(props.loaded, props.total);
  const percent = fraction === null ? null : Math.round(fraction * 100);
  return (
    <div class="pv-loading" data-part="pdf-loading">
      <p class="pv-loading-title">{t('pdfLoading')}</p>
      <div
        class="pv-progress"
        data-part="pdf-progress"
        data-indeterminate={fraction === null ? 'true' : 'false'}
        role="progressbar"
        aria-label={t('pdfLoading')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
      >
        <div
          class="pv-progress-bar"
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </div>
      {props.total !== null && fraction !== null && (
        <p class="pv-loading-text">
          {t('pdfProgress', formatSize(props.loaded), formatSize(props.total))}
        </p>
      )}
    </div>
  );
}

function failureText(failure: PdfFailure | 'read' | 'large' | 'unconfirmed'): string {
  switch (failure) {
    case 'unconfirmed':
      return t('pdfUnconfirmed');
    case 'password':
      return t('pdfPassword');
    case 'invalid':
      return t('pdfBadFile');
    case 'other':
    case 'large':
      return t('pdfBadFile');
    case 'read':
      return t('pdfLoadError');
  }
}

export function PdfTab(props: {
  /** The address of the bytes, on the saved Canvas. */
  url: string;
  /** The record of the file, for the slim line above the toolbar. */
  file: PaneFile;
  links: FileLinks | null;
  /** False while the browser withholds access to the Canvas address. */
  access: boolean;
  onAllow(): void;
  host: PdfHost;
  active: boolean;
  /** Changes when the tab must read the file again. */
  attempt: number;
  /** The bytes did not load. The pane checks the permission again. */
  onReadFailed(): void;
  onRetry(): void;
}) {
  const { host } = props;
  const [phase, setPhase] = useState<Phase>({ kind: 'reading', loaded: 0, total: null });
  const started = useRef(false);
  if (props.active) started.current = true;
  const begin = started.current;
  const onReadFailed = useRef(props.onReadFailed);
  onReadFailed.current = props.onReadFailed;

  useEffect(() => {
    if (!begin) return;
    let live = true;
    const abort = new AbortController();
    setPhase({ kind: 'reading', loaded: 0, total: null });
    // The library loads while the bytes download.
    const library = host.loadPdfjs();
    library.catch(() => undefined);
    void (async () => {
      let bytes: Uint8Array;
      try {
        bytes = await host.readFile(
          props.url,
          (loaded, total) => {
            if (live) setPhase({ kind: 'reading', loaded, total });
          },
          abort.signal,
        );
      } catch (error) {
        if (!live || (error instanceof FileBytesError && error.kind === 'aborted')) return;
        if (error instanceof FileBytesError && error.kind === 'too_large') {
          // The record said the file was small, but the bytes are not. Reading again would not help.
          setPhase({ kind: 'error', failure: 'large' });
          return;
        }
        if (error instanceof FileBytesError && error.kind === 'unconfirmed') {
          // The background has not confirmed the sign-in for this student. The permission is fine.
          setPhase({ kind: 'error', failure: 'unconfirmed' });
          return;
        }
        setPhase({ kind: 'error', failure: 'read' });
        onReadFailed.current();
        return;
      }
      let lib: PdfjsLib;
      try {
        lib = await library;
      } catch {
        if (live) setPhase({ kind: 'error', failure: 'other' });
        return;
      }
      if (live) setPhase({ kind: 'viewer', lib, source: { bytes } });
    })();
    return () => {
      live = false;
      abort.abort();
    };
  }, [begin, props.attempt, props.url, host]);

  return (
    <div class="pv-tab" hidden={!props.active} data-part="pdf-tab">
      <PdfInfoLine
        file={props.file}
        links={props.links}
        access={props.access}
        onAllow={props.onAllow}
      />
      {phase.kind === 'reading' && begin && <Progress loaded={phase.loaded} total={phase.total} />}
      {phase.kind === 'error' && (
        <div class="pv-error" data-part="pdf-error" role="alert">
          <p>{failureText(phase.failure)}</p>
          {(phase.failure === 'read' || phase.failure === 'unconfirmed') && (
            <button type="button" class="wr-btn" onClick={props.onRetry}>
              {t('fileRetry')}
            </button>
          )}
          {phase.failure === 'unconfirmed' && props.links && (
            <a
              class="wr-btn"
              href={props.links.canvas}
              target="_blank"
              rel="noopener noreferrer"
              data-part="open-in-canvas-text"
            >
              {t('fileOpenInCanvas')}
            </a>
          )}
        </div>
      )}
      {phase.kind === 'viewer' && (
        <PdfViewer
          lib={phase.lib}
          source={phase.source}
          active={props.active}
          onFailed={(failure) => setPhase({ kind: 'error', failure })}
        />
      )}
    </div>
  );
}
