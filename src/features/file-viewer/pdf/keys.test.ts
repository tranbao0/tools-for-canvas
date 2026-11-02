// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { keyContextOf, pdfKeyAction, type KeyInput } from './keys';

const key = (name: string, extra: Partial<KeyInput> = {}): KeyInput => ({
  key: name,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  context: 'none',
  ...extra,
});

describe('the keys of the PDF viewer', () => {
  it('pages with PageUp, PageDown, Home and End', () => {
    expect(pdfKeyAction(key('PageUp'))).toBe('previous-page');
    expect(pdfKeyAction(key('PageDown'))).toBe('next-page');
    expect(pdfKeyAction(key('Home'))).toBe('first-page');
    expect(pdfKeyAction(key('End'))).toBe('last-page');
  });

  it('zooms with Ctrl or Cmd and plus, minus or 0', () => {
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
      expect(pdfKeyAction(key('+', modifier))).toBe('zoom-in');
      expect(pdfKeyAction(key('=', modifier))).toBe('zoom-in');
      expect(pdfKeyAction(key('-', modifier))).toBe('zoom-out');
      expect(pdfKeyAction(key('_', modifier))).toBe('zoom-out');
      expect(pdfKeyAction(key('0', modifier))).toBe('zoom-reset');
    }
    // Plus needs Shift on many layouts.
    expect(pdfKeyAction(key('+', { ctrlKey: true, shiftKey: true }))).toBe('zoom-in');
  });

  it('opens the search with Ctrl or Cmd and F, in either case', () => {
    expect(pdfKeyAction(key('f', { ctrlKey: true }))).toBe('search');
    expect(pdfKeyAction(key('F', { metaKey: true }))).toBe('search');
    // Ctrl+Shift+F is not the search.
    expect(pdfKeyAction(key('F', { ctrlKey: true, shiftKey: true }))).toBeNull();
  });

  it('leaves other keys alone', () => {
    for (const name of ['a', 'Enter', 'Escape', 'ArrowDown', ' ', 'Tab', 'f']) {
      expect(pdfKeyAction(key(name)), name).toBeNull();
    }
    expect(pdfKeyAction(key('s', { ctrlKey: true }))).toBeNull();
    expect(pdfKeyAction(key('PageDown', { ctrlKey: true }))).toBeNull();
  });

  it('leaves a key alone when Alt is down, and plain keys when Shift is down', () => {
    expect(pdfKeyAction(key('PageDown', { altKey: true }))).toBeNull();
    expect(pdfKeyAction(key('=', { ctrlKey: true, altKey: true }))).toBeNull();
    expect(pdfKeyAction(key('PageDown', { shiftKey: true }))).toBeNull();
  });

  it('keeps the plain keys where the focus has its own use for them', () => {
    for (const context of ['editable', 'tablist', 'menu'] as const) {
      for (const name of ['PageUp', 'PageDown', 'Home', 'End']) {
        expect(pdfKeyAction(key(name, { context })), `${context} ${name}`).toBeNull();
      }
    }
  });

  it('keeps the zoom and search keys working in a field, a tab list and a menu', () => {
    for (const context of ['editable', 'tablist', 'menu'] as const) {
      expect(pdfKeyAction(key('f', { ctrlKey: true, context }))).toBe('search');
      expect(pdfKeyAction(key('-', { ctrlKey: true, context }))).toBe('zoom-out');
    }
  });
});

describe('keyContextOf', () => {
  it('finds a field, the tab strip and a menu', () => {
    document.body.innerHTML = `
      <input id="field"><textarea id="area"></textarea>
      <div role="tablist"><button id="tab" role="tab"></button></div>
      <div role="menu"><button id="item"></button></div>
      <div id="plain"><button id="button"></button></div>`;
    const of = (id: string) => keyContextOf(document.getElementById(id));
    expect(of('field')).toBe('editable');
    expect(of('area')).toBe('editable');
    expect(of('tab')).toBe('tablist');
    expect(of('item')).toBe('menu');
    expect(of('button')).toBe('none');
    expect(keyContextOf(null)).toBe('none');
    expect(keyContextOf(document)).toBe('none');
  });
});
