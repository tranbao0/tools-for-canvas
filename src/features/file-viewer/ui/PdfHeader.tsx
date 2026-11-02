/**
 * The compact header of a PDF tab (design decision 25, item 7): one slim line above the toolbar
 * with the file name, the type and the size, and the two links as icon buttons at its end.
 */
import { t } from '../../../shared/ui/i18n';
import { DownloadIcon, ExternalLinkIcon, FileIcon } from '../../../shared/ui/icons';
import type { PaneFile } from './FileCard';
import { fileKind, formatSize, typeLabel } from './fileInfo';
import type { FileLinks } from './links';

const NEW_TAB = { target: '_blank', rel: 'noopener noreferrer' } as const;

/** "Download" and "Open in Canvas" as ghost icon buttons, each with a label and a tooltip. */
function PdfActions(props: { links: FileLinks | null }) {
  const { links } = props;
  if (!links) return null;
  return (
    <>
      <a
        class="pv-btn pv-link"
        href={links.download}
        data-part="download"
        aria-label={t('fileDownload')}
        title={t('fileDownload')}
        {...NEW_TAB}
      >
        <DownloadIcon />
      </a>
      <a
        class="pv-btn pv-link"
        href={links.canvas}
        data-part="open-in-canvas"
        aria-label={t('fileOpenInCanvas')}
        title={t('fileOpenInCanvas')}
        {...NEW_TAB}
      >
        <ExternalLinkIcon />
      </a>
    </>
  );
}

/** The slim line above the toolbar: the file, and the access button while the browser withholds access. */
export function PdfInfoLine(props: {
  file: PaneFile;
  links: FileLinks | null;
  access: boolean;
  onAllow(): void;
}) {
  const { file } = props;
  const size = formatSize(file.size);
  const type = typeLabel(file.contentType, file.name);
  return (
    <div class="pv-info" data-part="pdf-info">
      <span class="pv-info-icon">
        <FileIcon kind={fileKind(file.contentType, file.name)} />
      </span>
      <span class="pv-info-name" data-part="pdf-name" title={file.name}>
        {file.name}
      </span>
      <span class="pv-info-meta" data-part="pdf-meta">
        {size ? t('fileMeta', type, size) : type}
      </span>
      <span class="pv-spacer" />
      {!props.access && (
        <button
          type="button"
          class="wr-btn wr-btn-primary wr-btn-small"
          data-part="allow"
          onClick={props.onAllow}
        >
          {t('fileAllowAccess')}
        </button>
      )}
      <PdfActions links={props.links} />
    </div>
  );
}
