import { useEffect, useRef, useState } from 'preact/hooks';
import { FileBytesError } from '../../../shared/canvas/fileBytes';
import type { PdfHost } from './PdfTab';
import { decodeText, MAX_TEXT_BYTES, playerType } from './player';

/** Each tab owns its read and blob URL until it closes. SVG stays inside an image element. */
export function MediaTab(props: {
  host: PdfHost;
  url: string;
  name: string;
  contentType: string;
  active: boolean;
  attempt: number;
  onRetry(): void;
  onReadFailed(): void;
}) {
  const type = playerType(props.contentType, props.name);
  const started = useRef(false);
  if (props.active) started.current = true;
  const begin = started.current;
  const [source, setSource] = useState('');
  const [ready, setReady] = useState(false);
  const [partial, setPartial] = useState(false);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState<number | null>(null);
  const failed = useRef(props.onReadFailed);
  failed.current = props.onReadFailed;
  const kind = type?.kind;
  const mime = type?.mime;
  useEffect(() => {
    if (!begin || !kind || !mime) return;
    if ((kind === 'audio' || kind === 'video') && !document.createElement(kind).canPlayType(mime))
      return;
    const abort = new AbortController();
    let live = true;
    let blob = '';
    setSource('');
    setReady(false);
    setError('');
    void props.host
      .readFile(props.url, () => undefined, abort.signal)
      .then((bytes) => {
        if (!live) return;
        setReady(true);
        if (kind === 'text') {
          setSource(decodeText(bytes));
          setPartial(bytes.length > MAX_TEXT_BYTES);
        } else {
          blob = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mime }));
          setSource(blob);
        }
      })
      .catch((cause: unknown) => {
        if (!live) return;
        setError(
          cause instanceof FileBytesError && cause.kind === 'unconfirmed'
            ? "Canvas can't confirm your sign-in for this file"
            : "Couldn't load this file",
        );
        failed.current();
      });
    return () => {
      live = false;
      abort.abort();
      if (blob) URL.revokeObjectURL(blob);
    };
  }, [begin, kind, mime, props.host, props.url, props.attempt]);
  return (
    <div hidden={!props.active} class="fv-media">
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button type="button" class="wr-btn" onClick={props.onRetry}>
            Retry
          </button>
        </div>
      )}
      {source && kind === 'image' && (
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
              onClick={() => setZoom(Math.max(0.1, (zoom ?? 1) / 1.25))}
            >
              Zoom out
            </button>
            <button
              type="button"
              class="wr-btn"
              onClick={() => setZoom(Math.min(8, (zoom ?? 1) * 1.25))}
            >
              Zoom in
            </button>
          </div>
          <div class="fv-image-scroll">
            <img
              src={source}
              alt={props.name}
              style={
                zoom === null
                  ? { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }
                  : { zoom, maxWidth: 'none' }
              }
            />
          </div>
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
