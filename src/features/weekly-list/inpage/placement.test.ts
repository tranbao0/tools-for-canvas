// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { releaseLayout } from './layout';
import { REPLACED_ATTRIBUTE } from '../../../shared/canvas/widgetDashboard';
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

  it('makes no mutation record when a pass sets the same values again', async () => {
    const element = document.createElement('div');
    document.body.append(element);
    setInlineStyles(element, { visibility: 'hidden' });
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((list) => records.push(...list));
    observer.observe(element, { attributes: true });

    setInlineStyles(element, { visibility: 'hidden' });
    await Promise.resolve();
    expect(records).toHaveLength(0);

    element.style.setProperty('visibility', 'visible');
    setInlineStyles(element, { visibility: 'hidden' });
    expect(element.style.getPropertyValue('visibility')).toBe('hidden');
    observer.disconnect();
    clearInlineStyles(element);
    expect(element.hasAttribute('style')).toBe(false);
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

it('release restores a replaced widget and removes its marker', () => {
  const wrapper = document.createElement('div');
  wrapper.style.display = 'flex';
  wrapper.setAttribute(REPLACED_ATTRIBUTE, '');
  document.body.append(wrapper);
  setInlineStyles(wrapper, { visibility: 'hidden', display: 'none' });
  releaseLayout(document);
  expect(wrapper.style.display).toBe('flex');
  expect(wrapper.style.visibility).toBe('');
  expect(wrapper.hasAttribute(REPLACED_ATTRIBUTE)).toBe(false);
  expect(wrapper.hasAttribute(STYLED_ATTRIBUTE)).toBe(false);
  wrapper.remove();
});
