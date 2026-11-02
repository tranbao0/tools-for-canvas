/** Only known passive formats receive a player. */
export function playerType(
  contentType: string,
  name: string,
): { kind: 'image' | 'audio' | 'video' | 'text'; mime: string } | null {
  const mime = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const images: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif',
    svg: 'image/svg+xml',
  };
  const image = Object.values(images).includes(mime) ? mime : images[ext];
  if (image) return { kind: 'image', mime: image };
  if (/^(audio|video)\//.test(mime))
    return { kind: mime.startsWith('audio/') ? 'audio' : 'video', mime };
  if (
    (mime.startsWith('text/') && mime !== 'text/html') ||
    ['application/json', 'application/javascript', 'application/xml'].includes(mime) ||
    /^(txt|csv|md|json|js|ts|tsx|jsx|py|java|c|cpp|h|css|xml|yaml|yml|sh|rs|go|rb)$/.test(ext)
  )
    return { kind: 'text', mime: 'text/plain' };
  return null;
}
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;
/**
 * Text is read up to this many bytes: the shown part and a few bytes more, so that a character
 * cut at the limit is complete in the bytes. A UTF-8 character has at most 4 bytes.
 */
export const TEXT_READ_BYTES = MAX_TEXT_BYTES + 4;

/** An image is drawn only when it has at most this many pixels, the limit the PDF pages use. */
export const MAX_IMAGE_PIXELS = 16_777_216;
/** ... and at most this many pixels on a side. */
export const MAX_IMAGE_SIDE = 16_384;
/** A hidden audio or video tab frees a file larger than this, and reads it again when it shows. */
export const HIDDEN_MEDIA_LIMIT_BYTES = 20 * 1024 * 1024;

export function imageFits(width: number, height: number): boolean {
  return (
    width > 0 &&
    height > 0 &&
    width <= MAX_IMAGE_SIDE &&
    height <= MAX_IMAGE_SIDE &&
    width * height <= MAX_IMAGE_PIXELS
  );
}

/**
 * The size to draw an SVG at when the browser reports no size, such as a file with only a
 * `viewBox`. It reads the attributes of the root element with an inert parser. Nothing of the file
 * runs or loads, and the result is `null` when the file gives no usable size.
 */
export function svgDrawSize(bytes: Uint8Array): { width: number; height: number } | null {
  let root: Element;
  try {
    const text = new TextDecoder('utf-8').decode(bytes.subarray(0, 64 * 1024));
    const parsed = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
    if (parsed.localName !== 'svg') return null;
    root = parsed;
  } catch {
    return null;
  }
  const length = (name: string) => {
    const match = /^\s*([0-9]*\.?[0-9]+)\s*(px)?\s*$/.exec(root.getAttribute(name) ?? '');
    return match?.[1] ? Number(match[1]) : null;
  };
  const box = (root.getAttribute('viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const ratio = box.length === 4 && box[2]! > 0 && box[3]! > 0 ? box[2]! / box[3]! : null;
  let width = length('width');
  let height = length('height');
  if (width === null && height === null && ratio !== null) {
    width = 1024;
    height = 1024 / ratio;
  } else if (width === null && height !== null && ratio !== null) {
    width = height * ratio;
  } else if (height === null && width !== null && ratio !== null) {
    height = width / ratio;
  }
  if (width === null || height === null || width <= 0 || height <= 0) return null;
  return { width: Math.round(width), height: Math.round(height) };
}
export function decodeText(bytes: Uint8Array): string {
  const shown = bytes.subarray(0, MAX_TEXT_BYTES);
  try {
    // Only a cut file may end in half a character. Streaming drops that half and keeps the rest.
    return new TextDecoder('utf-8', { fatal: true }).decode(shown, {
      stream: bytes.length > MAX_TEXT_BYTES,
    });
  } catch {
    return new TextDecoder('windows-1252').decode(shown);
  }
}
