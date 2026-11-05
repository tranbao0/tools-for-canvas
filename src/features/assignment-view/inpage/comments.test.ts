// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  COMMENTS_CSS,
  COMMENTS_WRAPPER_ID,
  findComments,
  restoreStaleComments,
  takeComments,
} from './comments';

const COLUMN = `<div class="submission-details-comments" style="word-wrap: break-word; min-width: 1%;"><div style="background-color: #fff; height: 100%"><div class="comments" style="height: 100%"><div class="comment_list" aria-live="polite" style="padding: 10px; clear:right;"></div><div id="add_comment_form"><textarea class="ic-Input grading_comment"></textarea><button type="button" class="save_comment_button">Save</button></div></div></div></div>`;

const PAGE = `<div id="application"><div id="content"><div class="submission-details-container"><div class="submission-details-frame"></div>${COLUMN}</div></div><div id="right-side-wrapper"><aside id="right-side"><div id="av-submission-box" data-av-own></div></aside></div></div>`;

const box = () => document.getElementById('av-submission-box')!;

function take() {
  const column = findComments(document)!;
  const wrapper = document.createElement('div');
  wrapper.setAttribute('data-av-own', '');
  box().append(wrapper);
  return { column, wrapper, restore: takeComments(document, column, wrapper) };
}

beforeEach(() => {
  document.body.innerHTML = PAGE;
});
afterEach(() => {
  document.body.innerHTML = '';
});

describe('findComments', () => {
  it('finds the column that is a child of the container', () => {
    expect(findComments(document)?.className).toBe('submission-details-comments');
  });

  it('finds nothing for a column outside the container, or without a container', () => {
    document.querySelector('.submission-details-container')!.className = 'other';
    expect(findComments(document)).toBeNull();
    document.body.innerHTML = '';
    expect(findComments(document)).toBeNull();
  });
});

describe('takeComments', () => {
  it('moves the same node into the wrapper, leaves a mark, and puts it back exactly', () => {
    const before = document.getElementById('content')!.outerHTML;
    const { column, wrapper, restore } = take();
    expect(column.parentElement).toBe(wrapper);
    expect(wrapper.id).toBe(COMMENTS_WRAPPER_ID);
    // Canvas's node has the markup that Canvas drew: no attribute and no style of the view.
    expect(column.outerHTML).toBe(COLUMN);
    const container = document.querySelector('.submission-details-container')!;
    expect([...container.childNodes].some((n) => n.nodeValue === 'av-comments-home')).toBe(true);
    restore();
    expect(wrapper.isConnected).toBe(false);
    expect(document.getElementById('content')!.outerHTML).toBe(before);
  });

  it('adds one line "No Comments" of its own, before the column', () => {
    const { wrapper } = take();
    const none = wrapper.querySelector('.av-no-comments')!;
    expect(none.textContent).toBe('No Comments');
    expect(none.hasAttribute('data-av-own')).toBe(true);
    expect(wrapper.firstElementChild).toBe(none);
  });

  it('keeps the text that the student typed, and the focus when it was inside the column', () => {
    const area = document.querySelector<HTMLTextAreaElement>('textarea')!;
    area.focus();
    area.value = 'Thank you for the notes';
    area.setSelectionRange(5, 8);
    const { column, restore } = take();
    expect(column.querySelector('textarea')).toBe(area);
    expect(area.value).toBe('Thank you for the notes');
    expect(document.activeElement).toBe(area);
    area.blur();
    area.focus();
    restore();
    expect(document.querySelector('textarea')).toBe(area);
    expect(area.value).toBe('Thank you for the notes');
    expect(document.activeElement).toBe(area);
    expect([area.selectionStart, area.selectionEnd]).toEqual([5, 8]);
  });

  it('does not take the focus when it was outside the column', () => {
    const outside = document.createElement('button');
    document.getElementById('content')!.append(outside);
    outside.focus();
    const { restore } = take();
    expect(document.activeElement).toBe(outside);
    restore();
    expect(document.activeElement).toBe(outside);
  });

  it('keeps the handlers that Canvas bound on its own nodes', () => {
    let clicks = 0;
    document.querySelector('.save_comment_button')!.addEventListener('click', () => (clicks += 1));
    const { restore } = take();
    document.querySelector<HTMLButtonElement>('.save_comment_button')!.click();
    restore();
    document.querySelector<HTMLButtonElement>('.save_comment_button')!.click();
    expect(clicks).toBe(2);
  });

  it('leaves the page as it was when the wrapper is inside the column', () => {
    const column = findComments(document)!;
    const wrapper = document.createElement('div');
    column.querySelector('.comment_list')!.append(wrapper);
    expect(() => takeComments(document, column, wrapper)).toThrow();
    const container = document.querySelector('.submission-details-container')!;
    expect(column.parentElement).toBe(container);
    expect([...container.childNodes].some((n) => n.nodeType === Node.COMMENT_NODE)).toBe(false);
  });

  it('gives the wrapper the direction and the language of the page', () => {
    document.documentElement.setAttribute('dir', 'rtl');
    document.documentElement.setAttribute('lang', 'ar');
    try {
      const { wrapper } = take();
      expect(wrapper.getAttribute('dir')).toBe('rtl');
      expect(wrapper.getAttribute('lang')).toBe('ar');
    } finally {
      document.documentElement.removeAttribute('dir');
      document.documentElement.removeAttribute('lang');
    }
  });

  it('puts the column into the container when its mark is gone', () => {
    const { column, restore } = take();
    document
      .querySelector('.submission-details-container')!
      .childNodes.forEach((node) => node.nodeType === Node.COMMENT_NODE && node.remove());
    restore();
    expect(column.parentElement?.className).toBe('submission-details-container');
  });
});

describe('the rules of the column', () => {
  it('are scoped by the wrapper, and every rule on Canvas properties is important', () => {
    const rules = COMMENTS_CSS.split('}').filter((rule) => rule !== '');
    for (const rule of rules) expect(rule.startsWith(`#${COMMENTS_WRAPPER_ID}`)).toBe(true);
    for (const property of ['border:0', 'height:auto', 'padding:0', 'background:transparent']) {
      expect(COMMENTS_CSS).toContain(`${property}!important`);
    }
  });

  it('keeps the horizontal scroller of the list, so a wide comment scrolls inside the box', () => {
    expect(COMMENTS_CSS).toContain(`#${COMMENTS_WRAPPER_ID} .comments{`);
    expect(COMMENTS_CSS).toContain('overflow-x:auto!important');
    expect(COMMENTS_CSS).not.toContain('overflow:visible');
  });

  it('shows "No Comments" only while the list holds no comment', () => {
    expect(COMMENTS_CSS).toContain(
      `#${COMMENTS_WRAPPER_ID}:has(.comment_list .comment)>.av-no-comments{display:none}`,
    );
  });
});

describe('restoreStaleComments', () => {
  it('puts the column back from the wrapper of a dead copy, and leaves the wrapper to the sweep', () => {
    const before = document.getElementById('content')!.outerHTML;
    const { column, wrapper } = take();
    restoreStaleComments(document);
    expect(document.getElementById('content')!.outerHTML).toBe(before);
    expect(wrapper.contains(column)).toBe(false);
    expect(
      document.querySelector('.submission-details-container > .submission-details-comments'),
    ).toBe(column);
  });

  it('ignores a wrapper that is not the own node of the box', () => {
    const { column, wrapper } = take();
    wrapper.removeAttribute('data-av-own');
    restoreStaleComments(document);
    expect(column.parentElement).toBe(wrapper);
  });

  it('ignores a wrapper that is not in the box of the right column', () => {
    const { column, wrapper } = take();
    document.getElementById('content')!.append(wrapper);
    restoreStaleComments(document);
    expect(column.parentElement).toBe(wrapper);
  });

  it('ignores a forged wrapper id, a forged mark and an element of another author', () => {
    const forged = document.createElement('div');
    forged.id = COMMENTS_WRAPPER_ID;
    forged.setAttribute('data-av-own', '');
    forged.innerHTML = '<div class="submission-details-comments">fake</div><!--av-comments-home-->';
    document.getElementById('content')!.prepend(forged);
    const before = document.body.innerHTML;
    restoreStaleComments(document);
    expect(document.body.innerHTML).toBe(before);
  });

  it('removes a mark that no column belongs to', () => {
    const container = document.querySelector('.submission-details-container')!;
    container.append(document.createComment('av-comments-home'));
    restoreStaleComments(document);
    expect([...container.childNodes].some((n) => n.nodeType === Node.COMMENT_NODE)).toBe(false);
  });

  it('does nothing on a page that was never changed', () => {
    const before = document.body.innerHTML;
    restoreStaleComments(document);
    expect(document.body.innerHTML).toBe(before);
  });
});
