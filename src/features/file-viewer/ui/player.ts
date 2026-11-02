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
export function decodeText(bytes: Uint8Array): string {
  const shown = bytes.subarray(0, MAX_TEXT_BYTES);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(shown);
  } catch {
    return new TextDecoder('windows-1252').decode(shown);
  }
}
