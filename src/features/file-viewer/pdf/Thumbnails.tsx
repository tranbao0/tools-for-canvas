/** The side list of page thumbnails (design decision 25). Each thumbnail draws when it comes near the view. */
import { useEffect, useRef } from 'preact/hooks';
import { t } from '../../../shared/ui/i18n';
import { usePull } from '../../../shared/ui/pull';
import type { PdfDocument } from './types';
import { THUMBNAIL_WIDTH, ThumbnailRenderer } from './thumbnails';

export function Thumbnails(props: {
  doc: PdfDocument;
  pageCount: number;
  page: number;
  /** The height of a thumbnail slot before it draws, as a part of its width. */
  aspect: number;
  onPick(page: number): void;
}) {
  const list = useRef<HTMLDivElement>(null);
  // The thumbnails are in the frame of the pane too: the wheel never moves the Canvas page.
  usePull(list, undefined, true);

  useEffect(() => {
    const root = list.current;
    if (!root) return;
    const renderer = new ThumbnailRenderer(props.doc, root);
    root.querySelectorAll<HTMLElement>('[data-slot]').forEach((slot, index) => {
      renderer.observe(slot, index);
    });
    return () => renderer.destroy();
  }, [props.doc, props.pageCount]);

  useEffect(() => {
    // The thumbnail of the page in view stays in view of the list.
    const current = list.current?.querySelector<HTMLElement>('[aria-current="page"]');
    const root = list.current;
    if (!current || !root) return;
    const top = current.offsetTop;
    if (top < root.scrollTop || top + current.offsetHeight > root.scrollTop + root.clientHeight) {
      root.scrollTop = top - (root.clientHeight - current.offsetHeight) / 2;
    }
  }, [props.page]);

  const slotHeight = Math.round(THUMBNAIL_WIDTH * props.aspect);
  return (
    <div
      class="pv-thumbs"
      ref={list}
      role="list"
      aria-label={t('pdfThumbnails')}
      data-part="pdf-thumbs"
    >
      {Array.from({ length: props.pageCount }, (_unused, index) => {
        const number = index + 1;
        return (
          <div role="listitem" key={number} class="pv-thumb-item">
            <button
              type="button"
              class="pv-thumb"
              data-part="pdf-thumb"
              aria-label={t('pdfThumbnailLabel', String(number))}
              aria-current={number === props.page ? 'page' : undefined}
              onClick={() => props.onPick(number)}
            >
              <span
                class="pv-thumb-slot"
                data-slot=""
                style={{ width: `${THUMBNAIL_WIDTH}px`, minHeight: `${slotHeight}px` }}
              />
              <span class="pv-thumb-number">{number}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
