// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDock } from '../../file-viewer/dock';
import { FEEDBACK_HOST_ID } from './feedbackPane';
import { PREVIEW_HOST_ID } from './previewPane';
import { removeStaleView, STALE_PANE_IDS } from './stale';

const ORIGIN = 'https://school.instructure.com';

/** Two rows as Canvas draws them, with the button, the mark and the style that a dead copy left. */
const PAGE = `
<ul class="ig-list">
<li><div class="ig-row" id="assignment_101" data-av-open><div class="ig-row__layout"><div class="ig-info"><a class="ig-title" href="${ORIGIN}/courses/12/assignments/101">Essay</a></div><button class="canvas-menu">Options</button><button type="button" data-av-own data-av-preview aria-pressed="true">Preview</button></div></div></li>
<li><div class="ig-row" id="assignment_102"><div class="ig-row__layout"><div class="ig-info"><a class="ig-title" href="${ORIGIN}/courses/12/assignments/102">Reading</a></div><button type="button" data-av-own data-av-preview aria-pressed="false">Preview</button></div></div></li>
</ul>`;

beforeEach(() => {
  document.head.innerHTML = '<style id="av-styles" data-av-own>.x{}</style>';
  document.body.innerHTML = PAGE;
});

describe('removeStaleView', () => {
  it('removes the buttons, the marks and the style of an earlier copy from the list and the head', () => {
    const menu = document.querySelector('#assignment_101 .canvas-menu')!.outerHTML;
    const title = document.querySelector('#assignment_101 a')!.outerHTML;
    removeStaleView(document, '/courses/12/assignments');
    expect(document.querySelector('[data-av-own]')).toBeNull();
    expect(document.querySelector('[data-av-open]')).toBeNull();
    expect(document.getElementById('av-styles')).toBeNull();
    // Canvas's own controls and the title link stay as they are.
    expect(document.querySelector('#assignment_101 .canvas-menu')!.outerHTML).toBe(menu);
    expect(document.querySelector('#assignment_101 a')!.outerHTML).toBe(title);
  });

  it('removes the nodes of an earlier copy of the script from the list and the head', () => {
    const list = document.querySelector('#assignment_101')!.parentElement!;
    list.insertAdjacentHTML('beforeend', '<div data-av-own><span>old</span></div>');
    document.head.insertAdjacentHTML('beforeend', '<style data-av-own>.y{}</style>');
    document.querySelector('#assignment_101')?.setAttribute('data-av-mark', '');
    removeStaleView(document, '/courses/12/assignments');
    expect(document.querySelector('[data-av-own]')).toBeNull();
    expect(document.querySelector('[data-av-mark]')).toBeNull();
  });

  it('leaves the marks of other authors alone outside the parts that the view owns', () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div class="user_content" data-av-mark><p data-av-own>text</p></div>',
    );
    const before = document.querySelector('.user_content')!.outerHTML;
    removeStaleView(document, '/courses/12/assignments');
    expect(document.querySelector('.user_content')!.outerHTML).toBe(before);
  });

  it.each(['/courses/12/assignments/101/submissions/42', '/courses/12/assignments'])(
    'removes the feedback pane and the turn-in pane of an earlier copy on %s',
    (pathname) => {
      document.body.insertAdjacentHTML(
        'beforeend',
        '<div id="tools-feedback" data-av-own></div><div id="tools-turn-in" data-av-own></div><div id="tools-file-viewer"></div>',
      );
      removeStaleView(document, pathname);
      expect(document.getElementById('tools-feedback')).toBeNull();
      expect(document.getElementById('tools-turn-in')).toBeNull();
      // The file pane is no node of this view.
      expect(document.getElementById('tools-file-viewer')).not.toBeNull();
    },
  );

  describe('the padding that a dead copy left for its dock', () => {
    const html = document.documentElement;
    /** A copy that died with its pane open: the pane and the padding stay, the state of the copy is gone. */
    function dieWithOpenPane(id: string): void {
      const dock = createDock({
        role: id === 'tools-turn-in' ? 'turn-in' : 'feedback',
        id,
        label: 'Pane',
        resizeLabel: 'Resize',
        width: 480,
        onResized: () => undefined,
      });
      dock.host.setAttribute('data-av-own', '');
      dock.open();
      delete (globalThis as unknown as Record<symbol, unknown>)[
        Symbol.for('tools-for-canvas.dock')
      ];
    }
    afterEach(() => {
      html.removeAttribute('style');
      html.removeAttribute('data-weekrow-room');
      delete (globalThis as unknown as Record<symbol, unknown>)[
        Symbol.for('tools-for-canvas.dock')
      ];
    });

    it.each([
      ['/courses/12/assignments/101/submissions/42', 'tools-feedback'],
      ['/courses/12/assignments', 'tools-turn-in'],
    ])('is given back on %s, to what the page had before', (pathname, id) => {
      html.style.setProperty('padding-right', '13px');
      dieWithOpenPane(id);
      expect(html.style.getPropertyValue('padding-right')).toBe('480px');
      removeStaleView(document, pathname);
      expect(document.getElementById(id)).toBeNull();
      expect(html.style.getPropertyValue('padding-right')).toBe('13px');
      expect(html.style.getPropertyPriority('padding-right')).toBe('');
      expect(html.hasAttribute('data-weekrow-room')).toBe(false);
    });

    it('is given back with no padding when the page had none', () => {
      dieWithOpenPane('tools-feedback');
      removeStaleView(document, '/courses/12/assignments/101/submissions/42');
      expect(html.style.getPropertyValue('padding-right')).toBe('');
    });

    it('is given back with the priority that the page had', () => {
      html.style.setProperty('padding-right', '9px', 'important');
      dieWithOpenPane('tools-turn-in');
      removeStaleView(document, '/courses/12/assignments');
      expect(html.style.getPropertyValue('padding-right')).toBe('9px');
      expect(html.style.getPropertyPriority('padding-right')).toBe('important');
    });

    it('never changes the padding of Canvas, which no copy of the extension set', () => {
      html.style.setProperty('padding-right', '13px');
      removeStaleView(document, '/courses/12/assignments');
      removeStaleView(document, '/courses/12/assignments/101/submissions/42');
      removeStaleView(document, '/courses/12/assignments/101');
      expect(html.style.getPropertyValue('padding-right')).toBe('13px');
    });

    it('keeps the padding while a pane of a live copy is on the page', () => {
      dieWithOpenPane('tools-feedback');
      // A live pane carries the mark of a dock, as every pane host does.
      document.body.insertAdjacentHTML(
        'beforeend',
        '<div id="tools-file-viewer" data-weekrow-dock></div>',
      );
      removeStaleView(document, '/courses/12/assignments/101/submissions/42');
      expect(html.style.getPropertyValue('padding-right')).toBe('480px');
      document.getElementById('tools-file-viewer')!.remove();
    });

    it('ignores a record that is no padding', () => {
      html.style.setProperty('padding-right', '480px', 'important');
      html.setAttribute('data-weekrow-room', '{"value":"url(x)","priority":"important"}');
      removeStaleView(document, '/courses/12/assignments');
      expect(html.style.getPropertyValue('padding-right')).toBe('480px');
    });
  });

  it('keeps a page element that only has the id of a pane', () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div id="tools-feedback"></div><div id="tools-turn-in"></div>',
    );
    removeStaleView(document, '/courses/12/assignments');
    expect(document.getElementById('tools-feedback')).not.toBeNull();
    expect(document.getElementById('tools-turn-in')).not.toBeNull();
  });

  it('names the same ids as the two panes', () => {
    expect(STALE_PANE_IDS).toEqual([FEEDBACK_HOST_ID, PREVIEW_HOST_ID]);
  });

  it('removes the host of an earlier copy on a Submission Details page, and no comment mark', () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div id="av-submission-details" data-av-own></div><div class="submission-details-container"><div class="submission-details-comments"><p data-av-own>teacher</p></div></div>',
    );
    removeStaleView(document, '/courses/12/assignments/101/submissions/42');
    expect(document.getElementById('av-submission-details')).toBeNull();
    expect(document.querySelector('.submission-details-comments p[data-av-own]')).not.toBeNull();
  });

  describe('the place checks on a Submission Details page', () => {
    const PAGE = '/courses/12/assignments/101/submissions/42';
    const FORGED_HOST =
      '<div id="av-submission-details" data-av-own><p>forged</p></div><div class="submission-details-container"><div class="submission-details-frame"></div></div>';

    it('keeps a forged host in the rubric and removes the real stale host next to it', () => {
      document.body.insertAdjacentHTML(
        'beforeend',
        `<div id="rubric_holder">${FORGED_HOST}</div><div id="av-submission-details" data-av-own></div><div class="submission-details-container"><div class="submission-details-frame"></div><div class="submission-details-comments"></div></div>`,
      );
      removeStaleView(document, PAGE);
      const hosts = document.querySelectorAll('#av-submission-details');
      expect(hosts).toHaveLength(1);
      expect(hosts[0]!.closest('#rubric_holder')).not.toBeNull();
    });

    it('keeps a forged host that stands before a forged container in the rubric, without a real host', () => {
      document.body.insertAdjacentHTML(
        'beforeend',
        `<div id="rubric_holder">${FORGED_HOST}</div><div class="submission-details-container"><div class="submission-details-frame"></div></div>`,
      );
      removeStaleView(document, PAGE);
      expect(document.querySelector('#rubric_holder #av-submission-details')).not.toBeNull();
    });

    it('removes the real host after the frame, and keeps a host after a forged frame', () => {
      document.body.insertAdjacentHTML(
        'beforeend',
        '<div id="rubric_holder"><div class="submission-details-container"><div class="submission-details-frame"></div><div id="av-submission-details" data-av-own></div></div></div><div class="submission-details-container"><div class="submission-details-frame"></div><div id="av-submission-details" data-av-own></div></div>',
      );
      removeStaleView(document, PAGE);
      const hosts = document.querySelectorAll('#av-submission-details');
      expect(hosts).toHaveLength(1);
      expect(hosts[0]!.closest('#rubric_holder')).not.toBeNull();
    });

    it('removes the wrapper of the rubric in the real host, and keeps a forged one in the rubric', () => {
      document.body.insertAdjacentHTML(
        'beforeend',
        '<div id="rubric_holder"><div class="submission-details-frame"><div id="av-rubric" data-av-own></div></div></div><div id="av-submission-details" data-av-own><div id="av-rubric" data-av-own></div></div><div class="submission-details-container"><div class="submission-details-frame"></div></div>',
      );
      removeStaleView(document, PAGE);
      const wrappers = document.querySelectorAll('#av-rubric');
      expect(wrappers).toHaveLength(1);
      expect(wrappers[0]!.closest('#rubric_holder')).not.toBeNull();
    });
  });

  describe('the own link of the title row on a Submission Details page', () => {
    const PAGE = '/courses/12/assignments/101/submissions/42';
    const BUTTONS =
      '<div class="ic-Action-header__Secondary"><a href="/courses/12/assignments/101#submit" class="Button Button--primary">Re-submit Assignment</a><a data-av-own href="/courses/12/assignments/101" class="Button Button--primary">Go to assignment</a></div>';

    it('removes the link of a dead copy and keeps the button of Canvas with its text', () => {
      document.body.insertAdjacentHTML('beforeend', BUTTONS);
      removeStaleView(document, PAGE);
      const links = [...document.querySelectorAll('.ic-Action-header__Secondary a')];
      expect(links.map((link) => link.textContent)).toEqual(['Re-submit Assignment']);
      expect(links[0]!.outerHTML).toBe(
        '<a href="/courses/12/assignments/101#submit" class="Button Button--primary">Re-submit Assignment</a>',
      );
    });

    it('looks nowhere else for an own link: not on the assignment page, the list, or in a comment', () => {
      document.body.insertAdjacentHTML(
        'beforeend',
        `${BUTTONS}<div class="submission-details-comments"><a data-av-own href="/x">Go to assignment</a></div><div class="other"><a data-av-own href="/y">Go to assignment</a></div>`,
      );
      removeStaleView(document, '/courses/12/assignments/101');
      removeStaleView(document, '/courses/12/assignments');
      expect(document.querySelectorAll('a[data-av-own]')).toHaveLength(3);
      removeStaleView(document, PAGE);
      expect(document.querySelectorAll('a[data-av-own]')).toHaveLength(2);
      expect(document.querySelector('.ic-Action-header__Secondary a[data-av-own]')).toBeNull();
    });
  });
});
