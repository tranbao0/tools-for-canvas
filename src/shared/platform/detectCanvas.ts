/**
 * Detects a Canvas page. See docs/design.md, decision 5.
 *
 * `isCanvasDocument` runs in two places: in the detector content script, and in a web page
 * through `scripting.executeScript({ func: isCanvasDocument })`. The browser serializes an
 * injected function to text, so it must stay self-contained: it may use only its own parameter,
 * its own local names and page globals, never imports or other names from this module.
 */

/**
 * Whether the document is a Canvas LMS page. It reads only these two Canvas markers:
 * - `#application.ic-app`, the root of the normal Canvas layout;
 * - the inline head script that assigns both `INST` and `ENV`, which every Canvas layout has.
 *
 * Called with no argument, it checks the global `document` of the page it runs in.
 */
export function isCanvasDocument(doc: Document = document): boolean {
  const app = doc.getElementById('application');
  if (app !== null && app.classList.contains('ic-app')) return true;

  const scripts = doc.querySelectorAll('script:not([src])');
  for (const script of Array.from(scripts)) {
    const text = script.textContent ?? '';
    if (/(?:^|[\s;])ENV\s*=/.test(text) && /(?:^|[\s;])INST\s*=/.test(text)) return true;
  }
  return false;
}
