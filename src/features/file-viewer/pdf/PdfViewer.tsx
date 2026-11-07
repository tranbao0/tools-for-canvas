/**
 * The PDF viewer of the file pane (design decision 25): a toolbar, an optional list of page
 * thumbnails, and the pages. The viewer owns one open document through a {@link PdfEngine}. It
 * destroys the document when it unmounts, which is when its tab closes.
 */
import { browser } from 'wxt/browser';
import { parsePositionReply, validPosition } from '../positions';
import type { TargetedKeyboardEvent } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../../../shared/ui/i18n';
import { usePull } from '../../../shared/ui/pull';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CloseIcon,
  SearchIcon,
  ThumbnailsIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from '../../../shared/ui/icons';
import type { PdfStage } from './failure';
import { PdfEngine, type EngineState } from './engine';
import { keyContextOf, pdfKeyAction } from './keys';
import { pdfjsDecoderUrl } from './loader';
import { parsePageInput } from './pageInput';
import { REFUSED_NAME } from './repairGuard';
import { Thumbnails } from './Thumbnails';
import type { PdfjsLib } from './types';
import { ZoomMenu } from './ZoomMenu';
import { WHEEL_LINE_PX, createWheelZoom } from './zoom';

export type PdfFailure = 'password' | 'invalid' | 'other';

/** The bytes of the document. The viewer takes them once, because the worker keeps them. */
export interface PdfSource {
  bytes: Uint8Array | null;
}

/** Sorts an error of PDF.js into what the pane tells the student. */
export function classifyPdfError(error: unknown): PdfFailure {
  const name = (error as { name?: unknown } | null)?.name;
  if (name === 'PasswordException') return 'password';
  if (
    name === 'InvalidPDFException' ||
    name === 'FormatError' ||
    name === 'MissingPDFException' ||
    name === REFUSED_NAME
  ) {
    return 'invalid';
  }
  return 'other';
}

const SEARCH_DELAY_MS = 200;
/** How long a viewer that has drawn waits for its saved position before it opens at the top. */
const READ_WAIT_MS = 3000;
/** The idle time after the last scroll or zoom change before the position is saved. */
const SAVE_IDLE_MS = 1000;

export function PdfViewer(props: {
  fileId: string;
  lib: PdfjsLib;
  source: PdfSource;
  /** Whether the tab of this document is the active tab. */
  active: boolean;
  onPageError(error: unknown, bytes: number, stage: PdfStage): void;
  onFailed(kind: PdfFailure, error: unknown, stage: PdfStage, bytes: number): void;
}) {
  const overflow = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 440px)');
    const update = () => {
      if (overflow.current) overflow.current.open = !query.matches;
    };
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const scroller = useRef<HTMLDivElement>(null);
  // The pane is in a frame: at the end of the pages the rows pull, and the wheel never moves the
  // Canvas page behind the pane.
  usePull(scroller, undefined, true, props.active);
  // Ctrl and the wheel zoom the pages, as the keys do, and never the page of the browser.
  useEffect(() => {
    const area = scroller.current;
    if (!area || !props.active) return;
    const step = createWheelZoom();
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const lines = event.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? 1 : WHEEL_LINE_PX;
      const direction = step(event.deltaY * lines, event.timeStamp);
      if (direction > 0) live.current.engine?.zoomIn();
      else if (direction < 0) live.current.engine?.zoomOut();
    };
    area.addEventListener('wheel', onWheel, { passive: false });
    return () => area.removeEventListener('wheel', onWheel);
  }, [props.active]);
  const pages = useRef<HTMLDivElement>(null);
  const searchField = useRef<HTMLInputElement>(null);
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 440px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 440px)');
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const [engine, setEngine] = useState<PdfEngine | null>(null);
  const [state, setState] = useState<EngineState | null>(null);
  const [thumbnails, setThumbnails] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<string | null>(null);
  // The page field commits on blur. A blur that a key press causes comes before the next render,
  // so the commit reads the draft from here and not from the last render.
  const draftNow = useRef<string | null>(null);
  const changeDraft = (next: string | null) => {
    draftNow.current = next;
    setDraft(next);
  };
  const live = useRef({ active: props.active, engine: null as PdfEngine | null });
  live.current.active = props.active;
  live.current.engine = engine;
  const failed = useRef(props.onFailed);
  failed.current = props.onFailed;
  const pageFailed = useRef(props.onPageError);
  pageFailed.current = props.onPageError;
  const searched = useRef('');

  useEffect(() => {
    const bytes = props.source.bytes;
    props.source.bytes = null;
    const container = scroller.current;
    const host = pages.current;
    if (!bytes || !container || !host) return;
    let cancelled = false;
    const byteLength = bytes.byteLength;
    let stage: PdfStage = 'worker start';
    let opened: PdfEngine | undefined;
    const abort = new AbortController();
    let restored = false;
    // The reply of the read carries the token that every save must send. Without a reply, nothing
    // saves.
    let token = '';
    let timer: ReturnType<typeof setTimeout> | undefined;
    let previous = '';
    const send = () => {
      timer = undefined;
      if (!opened) return;
      const { page, zoom } = opened.state;
      void browser.runtime
        .sendMessage({
          type: 'viewer:position-set',
          fileId: props.fileId,
          page,
          zoom: zoom.kind === 'scale' ? zoom.value : zoom.kind,
          token,
        })
        .catch(() => undefined);
    };
    const save = () => {
      if (!restored || token === '') return;
      clearTimeout(timer);
      timer = setTimeout(send, SAVE_IDLE_MS);
    };
    // A save that waits for the idle time goes out at once when the pane closes or the tab ends.
    const flush = () => {
      if (timer === undefined) return;
      clearTimeout(timer);
      send();
    };
    container.addEventListener('scroll', save, { passive: true });
    window.addEventListener('pagehide', flush);
    const saved = browser.runtime
      .sendMessage({
        type: 'viewer:position-get',
        fileId: props.fileId,
      })
      .then(parsePositionReply, () => null);
    // The reply may take long, such as while the background checks who is signed in. The viewer
    // waits for it only a short time. A late reply gives the token for the saves, not a restore.
    void saved.then((reply) => {
      token = reply?.token ?? '';
    });
    let giveUp: ReturnType<typeof setTimeout> | undefined;
    const waited = Promise.race([
      saved,
      new Promise<null>((resolve) => {
        giveUp = setTimeout(() => resolve(null), READ_WAIT_MS);
      }),
    ]);
    PdfEngine.open({
      onStage: (next) => {
        stage = next;
      },
      onPageError: (_index, error, stage) => {
        if (!cancelled) pageFailed.current(error, byteLength, stage);
      },
      lib: props.lib,
      bytes,
      wasmUrl: pdfjsDecoderUrl(),
      signal: abort.signal,
      scroller: container,
      pages: host,
      onChange: (next) => {
        if (!cancelled) setState(next);
        const position = JSON.stringify([next.page, next.zoom]);
        if (position !== previous) {
          previous = position;
          save();
        }
      },
    }).then(
      async (created) => {
        if (cancelled) {
          created.destroy();
          return;
        }
        opened = created;
        const reply = await waited;
        clearTimeout(giveUp);
        if (cancelled) return;
        const position = reply?.position;
        if (position && validPosition(position.page, position.zoom)) {
          created.setZoom(
            typeof position.zoom === 'number'
              ? { kind: 'scale', value: position.zoom }
              : { kind: position.zoom },
          );
          created.goToPage(position.page);
        }
        restored = true;
        if (!live.current.active) created.setActive(false);
        setEngine(created);
        setState(created.state);
      },
      (error: unknown) => {
        if (!cancelled) failed.current(classifyPdfError(error), error, stage, byteLength);
      },
    );
    return () => {
      flush();
      cancelled = true;
      clearTimeout(giveUp);
      container.removeEventListener('scroll', save);
      window.removeEventListener('pagehide', flush);
      abort.abort();
      opened?.destroy();
    };
  }, [props.lib, props.source, props.fileId]);

  useEffect(() => {
    engine?.setActive(props.active);
  }, [engine, props.active]);

  const openSearch = () => {
    setSearchOpen(true);
    requestAnimationFrame(() => {
      searchField.current?.focus();
      searchField.current?.select();
    });
  };
  const closeSearch = () => {
    setSearchOpen(false);
    setQuery('');
    searched.current = '';
    live.current.engine?.clearSearch();
    scroller.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    if (!props.active) return;
    const onKey = (event: KeyboardEvent) => {
      const action = pdfKeyAction({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        context: keyContextOf(event.target),
      });
      const current = live.current.engine;
      if (action === null || current === null) return;
      event.preventDefault();
      switch (action) {
        case 'previous-page':
          current.goToPage(current.currentPage - 1);
          break;
        case 'next-page':
          current.goToPage(current.currentPage + 1);
          break;
        case 'first-page':
          current.goToPage(1);
          break;
        case 'last-page':
          current.goToPage(current.pageCount);
          break;
        case 'zoom-in':
          current.zoomIn();
          break;
        case 'zoom-out':
          current.zoomOut();
          break;
        case 'zoom-reset':
          current.setZoom({ kind: 'scale', value: 1 });
          break;
        case 'search':
          openSearch();
          break;
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [props.active]);

  // The search runs a moment after the student stops typing.
  useEffect(() => {
    if (!engine || !searchOpen) return;
    const timer = setTimeout(() => {
      if (searched.current === query) return;
      searched.current = query;
      void engine.find(query);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [engine, query, searchOpen]);

  // Escape on any control of the bar closes the bar. The pane closes on Escape only when the
  // search bar is not open.
  const onSearchBarKey = (event: TargetedKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    closeSearch();
  };

  const onSearchKey = (event: TargetedKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && engine) {
      event.preventDefault();
      if (searched.current !== query) {
        searched.current = query;
        void engine.find(query);
      } else {
        engine.step(event.shiftKey ? -1 : 1);
      }
    }
  };

  const commitPage = () => {
    const typed = draftNow.current;
    if (typed === null || !engine) return;
    const page = parsePageInput(typed, engine.pageCount);
    changeDraft(null);
    if (page !== null) engine.goToPage(page);
  };

  const count = state?.pageCount ?? 0;
  const page = state?.page ?? 1;
  const search = state?.search;
  const ready = engine !== null && state !== null;
  const searchText =
    search === undefined || search.query === ''
      ? ''
      : search.status === 'searching'
        ? t('pdfSearching')
        : search.total === 0
          ? t('pdfSearchNone')
          : t('pdfSearchCount', String(search.current), String(search.total));

  const thumbnailControl = (
    <button
      type="button"
      class="pv-btn"
      data-part="pdf-thumbs-toggle"
      aria-label={t('pdfThumbnailsToggle')}
      title={t('pdfThumbnailsToggle')}
      aria-pressed={thumbnails}
      disabled={!ready}
      onClick={() => setThumbnails(!thumbnails)}
    >
      <ThumbnailsIcon />
    </button>
  );
  const zoomControl = state && (
    <ZoomMenu mode={state.zoom} scale={state.scale} onChoose={(mode) => engine?.setZoom(mode)} />
  );
  const searchControl = (
    <button
      type="button"
      class="pv-btn"
      data-part="pdf-search-toggle"
      aria-label={t('pdfSearch')}
      title={t('pdfSearch')}
      aria-pressed={searchOpen}
      disabled={!ready}
      onClick={() => (searchOpen ? closeSearch() : openSearch())}
    >
      <SearchIcon />
    </button>
  );
  return (
    <div class="pv-root" data-part="pdf-viewer" hidden={!props.active}>
      <div class="pv-toolbar" role="group" aria-label={t('pdfToolbar')}>
        {!compact && <span class="pv-wide-control">{thumbnailControl}</span>}
        <span class="pv-rule" aria-hidden="true" />
        <button
          type="button"
          class="pv-btn"
          data-part="pdf-previous"
          aria-label={t('pdfPreviousPage')}
          title={t('pdfPreviousPage')}
          disabled={!ready || page <= 1}
          onClick={() => engine?.goToPage(page - 1)}
        >
          <ArrowUpIcon />
        </button>
        <span class="pv-page-group">
          <input
            class="pv-page-input"
            data-part="pdf-page-input"
            type="text"
            inputMode="numeric"
            autocomplete="off"
            aria-label={t('pdfPageNumber')}
            value={draft ?? String(page)}
            disabled={!ready}
            onFocus={(event) => event.currentTarget.select()}
            onInput={(event) => changeDraft(event.currentTarget.value)}
            onBlur={commitPage}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitPage();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                changeDraft(null);
                event.currentTarget.blur();
              }
            }}
          />
          <span class="pv-page-count" data-part="pdf-page-count">
            {t('pdfPageCount', String(count))}
          </span>
        </span>
        <button
          type="button"
          class="pv-btn"
          data-part="pdf-next"
          aria-label={t('pdfNextPage')}
          title={t('pdfNextPage')}
          disabled={!ready || page >= count}
          onClick={() => engine?.goToPage(page + 1)}
        >
          <ArrowDownIcon />
        </button>
        <span class="pv-rule" aria-hidden="true" />
        <button
          type="button"
          class="pv-btn"
          data-part="pdf-zoom-out"
          aria-label={t('pdfZoomOut')}
          title={t('pdfZoomOut')}
          disabled={!ready}
          onClick={() => engine?.zoomOut()}
        >
          <ZoomOutIcon />
        </button>

        {!compact && <span class="pv-wide-control">{zoomControl}</span>}
        <button
          type="button"
          class="pv-btn"
          data-part="pdf-zoom-in"
          aria-label={t('pdfZoomIn')}
          title={t('pdfZoomIn')}
          disabled={!ready}
          onClick={() => engine?.zoomIn()}
        >
          <ZoomInIcon />
        </button>
        {!compact && <span class="pv-wide-control">{searchControl}</span>}
        <span class="pv-spacer" />
        {compact && (
          <details
            ref={overflow}
            class="pv-overflow"
            onKeyDown={(event) => {
              if (
                event.key === 'Escape' &&
                event.currentTarget.open &&
                window.matchMedia('(max-width: 440px)').matches
              ) {
                event.preventDefault();
                event.stopPropagation();
                event.currentTarget.open = false;
                event.currentTarget.querySelector('summary')?.focus();
              }
            }}
          >
            <summary class="pv-btn" aria-label={t('pdfMoreControls')} title={t('pdfMoreControls')}>
              ...
            </summary>
            <div class="pv-secondary">
              {thumbnailControl}
              {zoomControl}
              {searchControl}
            </div>
          </details>
        )}
      </div>
      {searchOpen && (
        <div class="pv-search" role="search" onKeyDown={onSearchBarKey}>
          <input
            ref={searchField}
            class="pv-search-input"
            data-part="pdf-search-input"
            type="text"
            autocomplete="off"
            spellcheck={false}
            aria-label={t('pdfSearchField')}
            placeholder={t('pdfSearchField')}
            value={query}
            onInput={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={onSearchKey}
          />
          <span class="pv-search-count" data-part="pdf-search-count" role="status">
            {searchText}
          </span>
          <button
            type="button"
            class="pv-btn"
            data-part="pdf-search-previous"
            aria-label={t('pdfSearchPrevious')}
            title={t('pdfSearchPrevious')}
            disabled={!search || search.total === 0}
            onClick={() => engine?.step(-1)}
          >
            <ArrowUpIcon />
          </button>
          <button
            type="button"
            class="pv-btn"
            data-part="pdf-search-next"
            aria-label={t('pdfSearchNext')}
            title={t('pdfSearchNext')}
            disabled={!search || search.total === 0}
            onClick={() => engine?.step(1)}
          >
            <ArrowDownIcon />
          </button>
          <button
            type="button"
            class="pv-btn"
            data-part="pdf-search-close"
            aria-label={t('pdfSearchClose')}
            title={t('pdfSearchClose')}
            onClick={closeSearch}
          >
            <CloseIcon />
          </button>
        </div>
      )}
      <div class="pv-main">
        {thumbnails && engine && state && (
          <Thumbnails
            doc={engine.document}
            pageCount={state.pageCount}
            page={state.page}
            active={props.active}
            aspect={engine.aspect}
            onPick={(number) => engine.goToPage(number)}
          />
        )}
        <div
          class="pv-scroll"
          ref={scroller}
          tabIndex={0}
          role="region"
          aria-label={t('pdfPages')}
          data-part="pdf-scroll"
        >
          <div class="pv-pages" ref={pages} />
        </div>
        {!ready && (
          <p class="pv-status" role="status">
            {t('pdfOpening')}
          </p>
        )}
      </div>
    </div>
  );
}
