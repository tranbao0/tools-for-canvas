// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { clearInlineStyles, setInlineStyles, STYLED_ATTRIBUTE } from './placement';

describe('inline styles of the layout', () => {
  it('gives back what the page had set, with its priority', () => {
    const element = document.createElement('div');
    element.setAttribute('style', 'width: 40%; color: red !important');

    setInlineStyles(element, { width: '300px', 'margin-right': '-20px' });
    setInlineStyles(element, { width: '310px' });
    expect(element.style.getPropertyValue('width')).toBe('310px');
    expect(element.style.getPropertyPriority('width')).toBe('important');

    clearInlineStyles(element);
    expect(element.style.getPropertyValue('width')).toBe('40%');
    expect(element.style.getPropertyValue('margin-right')).toBe('');
    expect(element.style.getPropertyValue('color')).toBe('red');
    expect(element.style.getPropertyPriority('color')).toBe('important');
    expect(element.hasAttribute(STYLED_ATTRIBUTE)).toBe(false);
  });

  it('leaves no style attribute on an element that had none', () => {
    const element = document.createElement('div');

    setInlineStyles(element, { padding: '4px' });
    clearInlineStyles(element);

    expect(element.outerHTML).toBe('<div></div>');
  });

  it('ignores a record that it cannot read', () => {
    const element = document.createElement('div');
    element.setAttribute(STYLED_ATTRIBUTE, 'not json');

    expect(() => clearInlineStyles(element)).not.toThrow();
    expect(element.hasAttribute(STYLED_ATTRIBUTE)).toBe(false);
  });
});
