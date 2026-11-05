// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { actionTarget, rightColumn } from './own';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('rightColumn', () => {
  it('finds the column after the content area', () => {
    document.body.innerHTML =
      '<div id="content"></div><div id="right-side-wrapper"><aside id="right-side"></aside></div>';
    expect(rightColumn(document)?.tagName).toBe('ASIDE');
  });

  it('skips a forged pair inside the content area, which comes first', () => {
    document.body.innerHTML =
      '<div id="content"><div id="right-side-wrapper"><div id="right-side">forged</div></div></div><div id="right-side-wrapper"><aside id="right-side"></aside></div>';
    expect(rightColumn(document)?.tagName).toBe('ASIDE');
  });

  it('finds nothing when only a forged pair is on the page', () => {
    document.body.innerHTML =
      '<div id="content"><div id="right-side-wrapper"><div id="right-side"></div></div></div>';
    expect(rightColumn(document)).toBeNull();
  });
});

describe('actionTarget', () => {
  function build() {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<button data-action="feedback"><span>text</span></button>';
    host.innerHTML = '<span data-action="feedback" data-index="0">comment</span>';
    document.body.append(host);
    return { host, shadow };
  }

  it('returns the action of a target inside the shadow root', () => {
    const { shadow } = build();
    const inner = shadow.querySelector('span')!;
    const event = { target: inner } as unknown as Event;
    expect(actionTarget(shadow, event)).toBe(shadow.querySelector('button'));
  });

  it('ignores a target in the light DOM that a slot shows', () => {
    const { host, shadow } = build();
    const event = { target: host.querySelector('span') } as unknown as Event;
    expect(actionTarget(shadow, event)).toBeNull();
  });

  it('ignores a target that is no element', () => {
    const { shadow } = build();
    expect(actionTarget(shadow, { target: document } as unknown as Event)).toBeNull();
  });
});
