/**
 * The rules of the page number input. The student types a whole number. A number outside the
 * document goes to the nearest page. Anything else is rejected, and the input shows the current
 * page again.
 */
export function parsePageInput(text: string, pageCount: number): number | null {
  if (pageCount < 1) return null;
  const trimmed = text.trim();
  if (!/^[0-9]{1,9}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Math.min(pageCount, Math.max(1, value));
}
