// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_CSS, installStyles, PAGE_CSS } from './styles';

/** Vitest does not process CSS, so the sheets are read as the build reads them. */
const listSheet = readFileSync(path.join(import.meta.dirname, 'styles.css'), 'utf8');
const pageSheet = readFileSync(path.join(import.meta.dirname, 'pages.css'), 'utf8');
const layoutSheet = readFileSync(path.join(import.meta.dirname, 'page.css'), 'utf8');

/** Selectors that only extension pages use: the page background, the panel and the offer. */
const PAGE_ONLY = [':root', ".wr[data-surface='panel']", '.wr-offer'];

/** Selectors that only the settings and welcome pages use. */
const LAYOUT_ONLY = ['.wr-page', '.wr-step', '.wr kbd'];

/** The custom properties that a Canvas page sets with the school's brand. */
const CANVAS_BRAND = ['--ic-brand-font-color-dark', '--ic-link-color', '--ic-brand-primary'];

describe('stylesheets', () => {
  it('keeps the page rules out of the in-page sheet', () => {
    for (const selector of PAGE_ONLY) {
      expect(listSheet, selector).not.toContain(selector);
      expect(pageSheet, selector).toContain(selector);
    }
    expect(listSheet).toContain('.wr-item');
    expect(pageSheet).not.toContain('.wr-item');
  });

  it('keeps the settings and welcome page layout out of the panel and the in-page sheet', () => {
    for (const selector of LAYOUT_ONLY) {
      expect(listSheet, selector).not.toContain(selector);
      expect(pageSheet, selector).not.toContain(selector);
      expect(layoutSheet, selector).toContain(selector);
    }
  });

  it('has the settings in the in-page sheet, because the gear opens them in place', () => {
    for (const selector of ['.wr-switch', '.wr-setting', '.wr-course-list']) {
      expect(listSheet, selector).toContain(selector);
    }
  });

  it('reads the Canvas brand colors, with Canvas defaults as fallbacks', () => {
    for (const name of CANVAS_BRAND) expect(listSheet).toMatch(new RegExp(`var\\(${name}, #`));
    expect(listSheet).toContain("'Lato Extended'");
    expect(listSheet).not.toContain('@font-face');
  });

  it('follows data-theme on the root, an ancestor or the shadow host, else the system', () => {
    expect(listSheet).toMatch(/\.wr \{\n {2}color-scheme: light dark;/);
    for (const theme of ['light', 'dark']) {
      for (const selector of [
        `[data-theme='${theme}'] .wr`,
        `.wr[data-theme='${theme}']`,
        `:host([data-theme='${theme}']) .wr`,
      ]) {
        expect(listSheet).toContain(selector);
      }
      expect(pageSheet).toContain(`:root[data-theme='${theme}']`);
    }
    // No surface forces a scheme on its own: only data-theme decides.
    expect(listSheet).not.toMatch(/data-surface='inpage'\][^{]*\{[^}]*color-scheme/);
  });

  it('clips the info line pipe at the start of a wrapped line and hides it from screen readers', () => {
    /** Every rule whose selector list is exactly `selector`, as one string. */
    const rules = (selector: string): string =>
      listSheet
        .split(/\n(?=\S)/)
        .filter((block) => block.startsWith(`${selector} {`))
        .join('\n');
    expect(rules('.wr-info')).toMatch(/display: flex;[^}]*flex-wrap: wrap;[^}]*overflow: hidden;/);
    const pipe = rules('.wr-info > ::before');
    expect(pipe).toContain("content: '|' / '';");
    expect(pipe).toContain('right: 100%;');
    expect(listSheet).not.toMatch(/\.wr-info[^{]*::after/);
  });

  it('draws no card frame or shadow around the in-page list', () => {
    const inpage = listSheet.match(/\.wr\[data-surface='inpage'\] \{[^}]*\}/)?.[0] ?? '';
    expect(inpage).not.toMatch(/border|shadow|radius/);
  });

  it('adds the list sheet, then the page sheet, to an extension page once', () => {
    document.head.innerHTML = '';
    installStyles(document);
    installStyles(document);
    const styles = document.head.querySelectorAll('style[data-weekrow]');
    expect(styles).toHaveLength(1);
    expect(styles[0]?.textContent).toBe(`${APP_CSS}\n${PAGE_CSS}`);
  });
});
