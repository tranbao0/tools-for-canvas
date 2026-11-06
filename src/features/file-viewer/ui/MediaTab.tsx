import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { FileBytesError } from '../../../shared/canvas/fileBytes';
import { t } from '../../../shared/ui/i18n';
import { usePull } from '../../../shared/ui/pull';
import { Progress, type PdfHost } from './PdfTab';
import {
  decodeText,
  HIDDEN_MEDIA_LIMIT_BYTES,
  imageFits,
  MAX_TEXT_BYTES,
  playerType,
  sniffRaster,
  svgBudget,
  svgDrawSize,
  TEXT_READ_BYTES,
} from './player';

/** Loads an image that is not in the page, so no right click, drag or "open" can reach its address. */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The image did not decode'));
    image.src = url;
  });
}

/** The size of the picture in its own pixels. */
function naturalSize(picture: HTMLCanvasElement | HTMLImageElement) {
  return picture instanceof HTMLImageElement
    ? { width: picture.naturalWidth, height: picture.naturalHeight }
    : { width: picture.width, height: picture.height };
}

/**
 * Each tab owns its read until it closes (design decision 25, items 4 and 5).
 *
 * File content never becomes a document of the extension. An image goes through a blob URL only
 * inside an element that is not in the page. A vector image is drawn on a canvas as soon as the
 * element has loaded, and a raster image (which cannot run script) stays in that element so that a
 * GIF can play. Either way the URL is freed at once, so no address of the file is left to open. Only audio and
 * video keep a URL while they play, because they need one, and they cannot run script.
 */
export function MediaTab(props: {
  host: PdfHost;
  url: string;
  name: string;
  contentType: string;
  active: boolean;
  attempt: number;
  onRetry(): void;
  onReadFailed(): void;
  /** A hidden audio or video file larger than this many bytes is freed. Defaults to 20 MB. */
  hiddenLimit?: number;
}) {
  const type = playerType(props.contentType, props.name);
  const started = useRef(false);
  if (props.active) started.current = true;
  const begin = started.current;
  const [source, setSource] = useState('');
  const [visual, setVisual] = useState<HTMLCanvasElement | HTMLImageElement | null>(null);
  const [ready, setReady] = useState(false);
  const [partial, setPartial] = useState(false);
  const [progress, setProgress] = useState<{ loaded: number; total: number | null } | null>(null);
  const [error, setError] = useState<{ text: string; retry: boolean } | null>(null);
  // A hidden audio or video file that is large gives up its bytes and reads them again when it shows.
  const [released, setReleased] = useState(false);
  const heavy = useRef(false);
  const shown = useRef(props.active);
  shown.current = props.active;
  const root = useRef<HTMLDivElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const failed = useRef(props.onReadFailed);
  failed.current = props.onReadFailed;
  const limit = props.hiddenLimit ?? HIDDEN_MEDIA_LIMIT_BYTES;
  const kind = type?.kind;
  // The text and the image scroll inside the frame of the pane: at their ends the rows pull, and
  // the wheel never moves the Canvas page. A player has no rows to pull.
  usePull(root, undefined, true, props.active && kind === 'text');
  usePull(holder, undefined, true, props.active && kind === 'image' && visual !== null);
  const mime = type?.mime;
  useEffect(() => {
    if (!begin || !kind || !mime) return;
    if (released) {
      setSource('');
      setVisual(null);
      return;
    }
    if ((kind === 'audio' || kind === 'video') && !document.createElement(kind).canPlayType(mime)) {
      setError({ text: "This browser can't play this file", retry: false });
      return;
    }
    const abort = new AbortController();
    let live = true;
    let free: (() => void) | undefined;
    setSource('');
    setVisual(null);
    setReady(false);
    setError(null);
    setProgress({ loaded: 0, total: null });
    const fail = (text: string) => {
      setProgress(null);
      setError({ text, retry: false });
    };
    const show = async (bytes: Uint8Array) => {
      // A raster image shows in an element. Its type comes from the first bytes, never from the
      // name or the header, so a file that holds markup is never given to an element as a picture.
      const raster = kind === 'image' ? sniffRaster(bytes) : null;
      if (kind === 'image' && raster === null && mime !== 'image/svg+xml') {
        fail("Couldn't show this image");
        return;
      }
      const blob = URL.createObjectURL(new Blob([bytes as BlobPart], { type: raster ?? mime }));
      let freed = false;
      free = () => {
        if (freed) return;
        freed = true;
        URL.revokeObjectURL(blob);
      };
      if (kind !== 'image') {
        heavy.current = bytes.length > limit;
        if (heavy.current && !shown.current) {
          // The tab was hidden while it read. It keeps no bytes and reads again when it shows.
          free();
          setProgress(null);
          setReleased(true);
          return;
        }
        setProgress(null);
        setSource(blob);
        return;
      }
      let picture: HTMLImageElement;
      try {
        picture = await loadImage(blob);
      } catch {
        free();
        if (live) fail("Couldn't show this image");
        return;
      }
      let width = picture.naturalWidth;
      let height = picture.naturalHeight;
      if ((width === 0 || height === 0) && mime === 'image/svg+xml') {
        // A vector file can give no size, such as one with only a view box.
        const size = svgDrawSize(bytes);
        width = size?.width ?? 0;
        height = size?.height ?? 0;
      }
      if (!live) {
        free();
        return;
      }
      if (!imageFits(width, height)) {
        free();
        fail(
          width > 0 && height > 0
            ? 'This image is too large to show here'
            : "Couldn't show this image",
        );
        return;
      }
      // A decoded picture takes 4 bytes a pixel. A hidden tab gives up a large one, like a media file.
      heavy.current = width * height * 4 > limit;
      if (heavy.current && !shown.current) {
        free();
        setProgress(null);
        setReleased(true);
        return;
      }
      if (raster !== null) {
        // A raster image cannot run script, and an animated GIF needs its own element to play.
        // The element keeps the decoded picture, so the address can go away at once.
        free();
        setProgress(null);
        setVisual(picture);
        return;
      }
      ({ width, height } = svgBudget(width, height));
      const drawing = document.createElement('canvas');
      drawing.width = width;
      drawing.height = height;
      const context = drawing.getContext('2d');
      if (!context) {
        free();
        fail("Couldn't show this image");
        return;
      }
      try {
        context.drawImage(picture, 0, 0, width, height);
      } catch {
        free();
        fail("Couldn't show this image");
        return;
      }
      // The picture is on the canvas. The address of the file goes away at once.
      free();
      setProgress(null);
      setVisual(drawing);
    };
    void props.host
      .readFile(
        props.url,
        (loaded, total) => {
          if (live) setProgress({ loaded, total });
        },
        abort.signal,
        kind === 'text' ? { truncateAt: TEXT_READ_BYTES } : undefined,
      )
      .then(async (bytes) => {
        if (!live) return;
        if (kind === 'text') {
          setProgress(null);
          setReady(true);
          setSource(decodeText(bytes));
          setPartial(bytes.length > MAX_TEXT_BYTES);
          return;
        }
        await show(bytes);
      })
      .catch((cause: unknown) => {
        if (!live || (cause instanceof FileBytesError && cause.kind === 'aborted')) return;
        setProgress(null);
        if (cause instanceof FileBytesError && cause.kind === 'too_large') {
          // The record said the file was small, but the bytes are not. Reading again would not help.
          setError({ text: 'This file is too large to show here', retry: false });
          return;
        }
        if (cause instanceof FileBytesError && cause.kind === 'unconfirmed') {
          // The permission is fine. Only the sign-in is not confirmed.
          setError({ text: "Canvas can't confirm your sign-in for this file", retry: true });
          return;
        }
        setError({ text: "Couldn't load this file", retry: true });
        failed.current();
      });
    return () => {
      live = false;
      abort.abort();
      free?.();
    };
  }, [begin, kind, mime, props.host, props.url, props.attempt, released, limit]);
  // A hidden tab gives up a large audio or video file. A tab that shows again gets it back.
  useEffect(() => {
    if (props.active) setReleased(false);
    else if (heavy.current) setReleased(true);
  }, [props.active]);
  // A tab that is not shown must not keep playing.
  useEffect(() => {
    if (props.active) return;
    root.current
      ?.querySelectorAll<HTMLMediaElement>('audio,video')
      .forEach((media) => media.pause());
  }, [props.active, source]);
  // The picture is made outside the page, so it goes in here, sized for the zoom.
  useLayoutEffect(() => {
    const place = holder.current;
    if (!place || !visual) return;
    if (visual instanceof HTMLImageElement) visual.alt = props.name;
    else {
      visual.setAttribute('role', 'img');
      visual.setAttribute('aria-label', props.name);
    }
    visual.style.cssText =
      zoom === null
        ? 'max-width:100%;max-height:100%;object-fit:contain'
        : `width:${naturalSize(visual).width * zoom}px;height:${naturalSize(visual).height * zoom}px;max-width:none`;
    if (visual.parentNode !== place) place.replaceChildren(visual);
  }, [visual, zoom, props.name]);
  const scale = () => {
    const width = visual ? naturalSize(visual).width : 0;
    const fitted = visual && width > 0 ? visual.clientWidth / width : 0;
    return zoom ?? (fitted > 0 ? fitted : 1);
  };
  return (
    <div ref={root} hidden={!props.active} class="fv-media">
      {error && (
        <div role="alert">
          <p>{error.text}</p>
          {error.retry && (
            <button type="button" class="wr-btn" onClick={props.onRetry}>
              Retry
            </button>
          )}
        </div>
      )}
      {begin && progress && !error && !released && (
        <Progress
          part="media"
          label={t('fileLoadingProgress')}
          loaded={progress.loaded}
          total={progress.total}
        />
      )}
      {visual && kind === 'image' && (
        <>
          <div class="fv-image-controls">
            <button type="button" class="wr-btn" onClick={() => setZoom(null)}>
              Zoom to fit
            </button>
            <button type="button" class="wr-btn" onClick={() => setZoom(1)}>
              100%
            </button>
            <button
              type="button"
              class="wr-btn"
              onClick={() => setZoom(Math.max(0.1, scale() / 1.25))}
            >
              Zoom out
            </button>
            <button
              type="button"
              class="wr-btn"
              onClick={() => setZoom(Math.min(8, scale() * 1.25))}
            >
              Zoom in
            </button>
          </div>
          <div class="fv-image-scroll" ref={holder} />
        </>
      )}
      {source && kind === 'audio' && <audio controls src={source} />}
      {source && kind === 'video' && <video controls src={source} />}
      {ready && kind === 'text' && (
        <>
          {partial && <p>Shown in part</p>}
          <pre>{source}</pre>
        </>
      )}
    </div>
  );
}
