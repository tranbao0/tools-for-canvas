/** The card of the active file: its name, type and size, and the links (design decision 25). */
import { t } from '../../../shared/ui/i18n';
import { DownloadIcon, ExternalLinkIcon, FileIcon } from '../../../shared/ui/icons';
import { fileKind, formatSize, typeLabel } from './fileInfo';
import { fileLinks, sameCanvasAddress } from './links';

/** The record of a file, as the background answers `viewer:file`. */
export interface PaneFile {
  name: string;
  contentType: string;
  size: number;
  url: string;
  courseId: string | null;
}

export type FileState = { kind: 'loading' } | { kind: 'ready'; file: PaneFile } | { kind: 'error' };

interface CardProps {
  fileId: string;
  state: FileState;
  origin: string;
  /** The course the student opened the file from, if the link told it. */
  courseHint: string | undefined;
  /** The address of the link that opened the file, when it carried a `verifier` or a `location`. */
  address: string | undefined;
  /** False while the browser withholds access to the Canvas address. */
  access: boolean;
  onRetry(): void;
  onAllow(): void;
}

const NEW_TAB = { target: '_blank', rel: 'noopener noreferrer' } as const;

function AllowAccess(props: { onAllow(): void }) {
  return (
    <button type="button" class="wr-btn wr-btn-primary" data-part="allow" onClick={props.onAllow}>
      {t('fileAllowAccess')}
    </button>
  );
}

export function FileCard(props: CardProps) {
  const { state } = props;
  if (state.kind === 'loading') {
    return (
      <div class="fv-card" aria-busy="true" data-part="card-loading">
        <span class="wr-sr" role="status">
          {t('fileLoading')}
        </span>
        <div class="fv-card-head" aria-hidden="true">
          <span class="wr-skel-bar fv-skel-icon" />
          <div class="fv-skel-lines">
            <span class="wr-skel-bar fv-skel-title" />
            <span class="wr-skel-bar fv-skel-meta" />
          </div>
        </div>
        <div class="fv-actions" aria-hidden="true">
          <span class="wr-skel-bar fv-skel-button" />
          <span class="wr-skel-bar fv-skel-button" />
        </div>
      </div>
    );
  }
  // The course the student opened the file from comes first, then the course of the record.
  const course = props.courseHint ?? (state.kind === 'ready' ? state.file.courseId : null);
  const links = fileLinks(props.origin, props.fileId, course);
  if (state.kind === 'error') {
    // The file did not load, so the student needs a way out that works: the address of the link
    // that they clicked, when Canvas gave the file only through it.
    const open = sameCanvasAddress(props.origin, props.address) ?? links?.canvas ?? null;
    return (
      <div class="fv-card wr-state" data-part="card-error">
        <div role="alert">
          <h2 class="wr-state-title">{t('fileLoadError')}</h2>
        </div>
        <div class="fv-actions">
          <button type="button" class="wr-btn wr-btn-primary" onClick={props.onRetry}>
            {t('fileRetry')}
          </button>
          {links && (
            <a class="wr-btn" href={links.download} data-part="download" {...NEW_TAB}>
              <DownloadIcon />
              {t('fileDownload')}
            </a>
          )}
          {open && (
            <a class="wr-btn" href={open} {...NEW_TAB}>
              {t('fileOpenInCanvas')}
              <ExternalLinkIcon />
            </a>
          )}
          {!props.access && <AllowAccess onAllow={props.onAllow} />}
        </div>
      </div>
    );
  }
  const { file } = state;
  const size = formatSize(file.size);
  const type = typeLabel(file.contentType, file.name);
  return (
    <div class="fv-card" data-part="card">
      <div class="fv-card-head">
        <span class="fv-card-icon">
          <FileIcon kind={fileKind(file.contentType, file.name)} />
        </span>
        <div class="fv-card-text">
          <h2 class="fv-card-name" data-part="card-name">
            {file.name}
          </h2>
          <p class="fv-card-meta" data-part="card-meta">
            {size ? t('fileMeta', type, size) : type}
          </p>
        </div>
      </div>
      <div class="fv-actions">
        {links && (
          <a class="wr-btn" href={links.download} data-part="download" {...NEW_TAB}>
            <DownloadIcon />
            {t('fileDownload')}
          </a>
        )}
        {links?.canvas && (
          <a class="wr-btn" href={links.canvas} data-part="open-in-canvas" {...NEW_TAB}>
            <ExternalLinkIcon />
            {t('fileOpenInCanvas')}
          </a>
        )}
        {!props.access && <AllowAccess onAllow={props.onAllow} />}
      </div>
    </div>
  );
}
