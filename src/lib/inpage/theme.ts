/**
 * The in-page list follows the Canvas page: it uses dark colors only when the page
 * background is dark. See docs/design.md, decision 19.
 */

export type PageTheme = 'light' | 'dark';

export interface Rgba {
  r: number;
  g: number;
  b: number;
  /** 0 to 1. */
  a: number;
}

/** A computed color: `rgb(r, g, b)` or `rgba(r, g, b, a)`, with commas. */
const RGB_FUNCTION =
  /^rgba?\(\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?\)$/;
/** sRGB relative luminance below which white text has more contrast than black text. */
const DARK_LUMINANCE = 0.179;

/**
 * Parses a computed CSS color in `rgb()` or `rgba()` form, with commas, as browsers report
 * `getComputedStyle(...).backgroundColor`. `transparent` is fully transparent. Other forms give `null`.
 */
export function parseCssColor(value: string): Rgba | null {
  const text = value.trim().toLowerCase();
  if (text === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const match = RGB_FUNCTION.exec(text);
  if (match === null) return null;
  const [, r, g, b, a = '1'] = match;
  return { r: Number(r), g: Number(g), b: Number(b), a: Number(a) };
}

function linearChannel(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of an opaque color, from 0 (black) to 1 (white). */
export function relativeLuminance(color: Rgba): number {
  return (
    0.2126 * linearChannel(color.r) +
    0.7152 * linearChannel(color.g) +
    0.0722 * linearChannel(color.b)
  );
}

/** Blends a color over white, as the browser does for a translucent page background. */
function overWhite(color: Rgba): Rgba {
  const blend = (channel: number): number => channel * color.a + 255 * (1 - color.a);
  return { r: blend(color.r), g: blend(color.g), b: blend(color.b), a: 1 };
}

export function isDarkColor(color: Rgba): boolean {
  return relativeLuminance(overWhite(color)) < DARK_LUMINANCE;
}

/**
 * The page theme from the background of `body`, or of `html` when the body is transparent.
 * A page with no background color is light.
 */
export function detectPageTheme(doc: Document = document): PageTheme {
  const view = doc.defaultView;
  if (view === null) return 'light';
  for (const element of [doc.body, doc.documentElement]) {
    if (element === null) continue;
    const color = parseCssColor(view.getComputedStyle(element).backgroundColor);
    if (color === null || color.a === 0) continue;
    return isDarkColor(color) ? 'dark' : 'light';
  }
  return 'light';
}
