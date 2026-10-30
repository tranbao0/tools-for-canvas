// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { APP_CSS, installStyles, PAGE_CSS } from './styles';

describe('installStyles', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
  });

  it('adds the list sheet, then the page sheet, to an extension page once', () => {
    installStyles(document);
    installStyles(document);
    const styles = document.head.querySelectorAll('style[data-weekrow]');
    expect(styles).toHaveLength(1);
    expect(styles[0]?.textContent).toBe(`${APP_CSS}\n${PAGE_CSS}`);
  });

  it('adds the extra sheet last', () => {
    installStyles(document, '.extra {}');
    expect(document.head.querySelector('style[data-weekrow]')?.textContent).toBe(
      `${APP_CSS}\n${PAGE_CSS}\n.extra {}`,
    );
  });
});
