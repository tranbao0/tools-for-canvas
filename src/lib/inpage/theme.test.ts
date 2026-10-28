// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { detectPageTheme, isDarkColor, parseCssColor, relativeLuminance } from './theme';

afterEach(() => {
  document.body.removeAttribute('style');
  document.documentElement.removeAttribute('style');
});

describe('parseCssColor', () => {
  it.each([
    ['rgb(255, 255, 255)', { r: 255, g: 255, b: 255, a: 1 }],
    ['rgba(0, 0, 0, 0)', { r: 0, g: 0, b: 0, a: 0 }],
    ['rgba(18, 18, 18, 0.5)', { r: 18, g: 18, b: 18, a: 0.5 }],
    ['transparent', { r: 0, g: 0, b: 0, a: 0 }],
    [' RGB(1, 2, 3) ', { r: 1, g: 2, b: 3, a: 1 }],
  ])('parses %j', (value, expected) => {
    expect(parseCssColor(value)).toEqual(expected);
  });

  it.each([
    '',
    'oklch(0.2 0.01 250)',
    'rgb(18 18 18 / 50%)',
    'rgb(100%, 0%, 0%)',
    'rgb(1, 2)',
    'rgb(a, b, c)',
    'rgb(1, 2, 3, 4, 5)',
    'rgb(1.2.3, 2, 3)',
    '#000',
  ])('gives null for %j', (value) => {
    expect(parseCssColor(value)).toBeNull();
  });
});

describe('isDarkColor', () => {
  it.each([
    [{ r: 255, g: 255, b: 255, a: 1 }, false],
    [{ r: 245, g: 245, b: 245, a: 1 }, false],
    [{ r: 30, g: 31, b: 34, a: 1 }, true],
    [{ r: 0, g: 0, b: 0, a: 1 }, true],
    [{ r: 102, g: 102, b: 102, a: 1 }, true],
    [{ r: 200, g: 0, b: 0, a: 1 }, true],
    [{ r: 255, g: 220, b: 0, a: 1 }, false],
    [{ r: 0, g: 0, b: 0, a: 0.1 }, false],
  ])('%j is dark: %s', (color, dark) => {
    expect(isDarkColor(color)).toBe(dark);
  });

  it('measures white as 1 and black as 0', () => {
    expect(relativeLuminance({ r: 255, g: 255, b: 255, a: 1 })).toBeCloseTo(1);
    expect(relativeLuminance({ r: 0, g: 0, b: 0, a: 1 })).toBe(0);
  });
});

describe('detectPageTheme', () => {
  it('is light for a page with no background color', () => {
    expect(detectPageTheme()).toBe('light');
  });

  it('follows a dark body background', () => {
    document.body.style.backgroundColor = 'rgb(24, 26, 27)';
    expect(detectPageTheme()).toBe('dark');
  });

  it('follows a light body background', () => {
    document.body.style.backgroundColor = 'rgb(255, 255, 255)';
    document.documentElement.style.backgroundColor = 'rgb(0, 0, 0)';
    expect(detectPageTheme()).toBe('light');
  });

  it('uses the html background when the body is transparent', () => {
    document.body.style.backgroundColor = 'rgba(0, 0, 0, 0)';
    document.documentElement.style.backgroundColor = 'rgb(20, 20, 20)';
    expect(detectPageTheme()).toBe('dark');
  });

  it('is light for a document without a window', () => {
    const detached = document.implementation.createHTMLDocument('x');
    expect(detectPageTheme(detached)).toBe('light');
  });
});
