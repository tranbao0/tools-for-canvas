// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  clickedElement,
  closeFile,
  PANEL_HOST_ATTRIBUTE,
  courseOfLink,
  fileTarget,
  isCommentTab,
  isTabId,
  linkName,
  normalizeTabs,
  openFile,
  normalizeWidth,
  validRequest,
  plainClick,
  isSubmissionPage,
  frameFileTarget,
  catchesDownload,
} from './model';

describe('file targets', () => {
  for (const path of [
    '/files/42',
    '/courses/12/files/42',
    '/courses/12/files/42/preview',
    '/files/42/download?wrap=1',
  ]) {
    it(path, () => expect(fileTarget(path, 'https://school.edu')).toEqual({ fileId: '42' }));
  }
  it('module item', () =>
    expect(fileTarget('/courses/12/modules/items/34', 'https://school.edu', '56')).toEqual({
      courseId: '12',
      moduleId: '56',
      itemId: '34',
    }));
  it('rejects another origin', () =>
    expect(fileTarget('https://other.edu/files/42', 'https://school.edu')).toBeNull());
});
describe('tabs', () => {
  it('activates an open file without duplicating it', () => {
    const state = openFile(openFile({ ids: [], active: null }, '1'), '2');
    expect(openFile(state, '1')).toEqual({ ids: ['1', '2'], active: '1' });
  });
  it('replaces the oldest inactive file at eight', () => {
    expect(openFile({ ids: ['1', '2', '3', '4', '5', '6', '7', '8'], active: '1' }, '9')).toEqual({
      ids: ['1', '3', '4', '5', '6', '7', '8', '9'],
      active: '9',
    });
  });
});
describe('channel', () => {
  it('accepts only ids and structural paths', () => {
    expect(validRequest('42')).toBe(true);
    expect(validRequest('/courses/12/files/42')).toBe(true);
    for (const value of [
      'https://school.edu/files/42',
      '//other.edu/files/42',
      '/files/42?url=https://other.edu',
      '../files/42',
      {},
      null,
    ])
      expect(validRequest(value)).toBe(false);
  });
});
describe('width', () => {
  it('normalizes invalid and extreme values', () => {
    expect(normalizeWidth(null)).toBe(480);
    expect(normalizeWidth(NaN)).toBe(480);
    expect(normalizeWidth(100)).toBe(360);
    expect(normalizeWidth(10000)).toBe(1344);
  });
});

describe('plain clicks', () => {
  const event = {
    isTrusted: true,
    button: 0,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
  };
  it('accepts a left click', () => expect(plainClick(event)).toBe(true));
  for (const key of ['ctrlKey', 'shiftKey', 'altKey', 'metaKey']) {
    it(key, () => expect(plainClick({ ...event, [key]: true })).toBe(false));
  }
  it('rejects a click that a script made', () =>
    expect(plainClick({ ...event, isTrusted: false })).toBe(false));
  it('rejects a middle click', () => expect(plainClick({ ...event, button: 1 })).toBe(false));
});
describe('closing a tab', () => {
  const state = { ids: ['1', '2', '3'], active: '2' };
  it('activates the tab that takes its place', () => {
    expect(closeFile(state, '2')).toEqual({ ids: ['1', '3'], active: '3' });
  });
  it('activates the tab before when the last tab closes', () => {
    expect(closeFile({ ids: ['1', '2', '3'], active: '3' }, '3')).toEqual({
      ids: ['1', '2'],
      active: '2',
    });
  });
  it('keeps the active tab when another tab closes', () => {
    expect(closeFile(state, '1')).toEqual({ ids: ['2', '3'], active: '2' });
  });
  it('leaves nothing active after the only tab', () => {
    expect(closeFile({ ids: ['1'], active: '1' }, '1')).toEqual({ ids: [], active: null });
  });
  it('ignores a tab that is not open', () => {
    expect(closeFile(state, '9')).toBe(state);
  });
});
describe('course of a link', () => {
  const origin = 'https://school.edu';
  it('reads the course from a course file link', () => {
    expect(courseOfLink('/courses/12/files/42', origin)).toBe('12');
    expect(courseOfLink(`${origin}/courses/12/files/42/download?wrap=1`, origin)).toBe('12');
    expect(courseOfLink('/courses/12/modules/items/3', origin)).toBe('12');
  });
  it('finds no course in other links', () => {
    expect(courseOfLink('/files/42', origin)).toBeNull();
    expect(courseOfLink('/courses/0/files/42', origin)).toBeNull();
    expect(courseOfLink('/courses/12/pages/x', origin)).toBeNull();
    expect(courseOfLink('https://other.edu/courses/12/files/42', origin)).toBeNull();
  });
});

describe('anonymous submission paths', () => {
  const path = '/courses/12/assignments/3/anonymous_submissions/aB12z';
  it('accepts the details frame and the download target', () => {
    expect(isSubmissionPage(path)).toBe(true);
    expect(isSubmissionPage(path + '/')).toBe(true);
    expect(fileTarget(path + '?download=42', 'https://school.edu')).toEqual({ fileId: '42' });
    expect(fileTarget(path + '?download=42&comment_id=1', 'https://school.edu')).toEqual({
      fileId: path + '?comment_id=1&download=42',
    });
  });
  it('keeps numeric ids for named submissions and rejects extra path segments', () => {
    expect(isSubmissionPage('/courses/12/assignments/3/submissions/aB12z')).toBe(false);
    expect(isSubmissionPage(path + '/extra')).toBe(false);
    expect(isSubmissionPage(path + '-')).toBe(false);
  });
});

describe('the element of a click', () => {
  const root = document.createElement('div');
  const inner = document.createElement('a');
  const outer = document.createElement('p');
  const event = (target: EventTarget | null, path: EventTarget[]) => ({
    target,
    composedPath: () => path,
  });

  it('is the target of a click outside any panel host', () => {
    expect(clickedElement(event(outer, [inner]))).toBe(outer);
    expect(clickedElement(event(null, []))).toBeNull();
  });

  it('is the first element of the path for a panel host with an open root', () => {
    const host = document.createElement('div');
    host.setAttribute(PANEL_HOST_ATTRIBUTE, '');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.append(inner);
    expect(clickedElement(event(host, [inner, shadow, host]))).toBe(inner);
  });

  it('stays the host when the path element is not inside its root', () => {
    const host = document.createElement('div');
    host.setAttribute(PANEL_HOST_ATTRIBUTE, '');
    host.attachShadow({ mode: 'open' });
    expect(clickedElement(event(host, [root, host]))).toBe(host);
  });
});

describe('sharded ids', () => {
  const origin = 'https://school.edu';
  const path = '/courses/12~345/assignments/23~456/submissions/34~567';
  it('matches file, course, module and submission identities', () => {
    expect(fileTarget('/courses/12~345/files/45~678/preview', origin)).toEqual({
      fileId: '45~678',
    });
    expect(courseOfLink('/courses/12~345/files/45~678', origin)).toBe('12~345');
    expect(fileTarget('/courses/12~345/modules/items/34~567', origin, '23~456')).toEqual({
      courseId: '12~345',
      moduleId: '23~456',
      itemId: '34~567',
    });
    expect(isSubmissionPage(path)).toBe(true);
    expect(fileTarget(`${path}?download=45~678`, origin)).toEqual({ fileId: '45~678' });
    document.body.innerHTML =
      '<table class="file-upload-submission-table"><tr><td><a class="file-upload-submission-info__link">File</a></td></tr></table>';
    expect(frameFileTarget(document.querySelector('a')!, '/files/45~678', origin, path)).toEqual({
      fileId: '45~678',
    });
    document.body.innerHTML =
      '<div id="right-side"><div class="details"><div class="content"><a download>File</a></div></div></div>';
    expect(
      catchesDownload(
        document.querySelector('a')!,
        '/files/45~678',
        origin,
        '/courses/12~345/assignments/23~456',
      ),
    ).toBe(true);
  });
  it.each(['12~', '~345', '12~345~678', '0~345', '12~0', '12~abc', '12%7E345'])(
    'rejects invalid id %s',
    (id) => {
      expect(fileTarget(`/files/${id}`, origin)).toBeNull();
      expect(isSubmissionPage(`/courses/${id}/assignments/23/submissions/34`)).toBe(false);
    },
  );
});

describe('preview routes', () => {
  const origin = 'https://school.edu';
  for (const route of [
    '/courses/12~3/files?preview=45~6',
    '/courses/12~3/files/folder/week%201/notes?preview=45~6',
    '/courses/12~3/files/folder?preview=45~6',
    '/courses/12~3/files/search?search_term=a&preview=45~6',
  ]) {
    it(route, () => expect(fileTarget(route, origin)).toEqual({ fileId: '45~6' }));
    for (const hostile of [
      'https://other.edu' + route,
      route.replace('/files', '/files/extra'),
      route.replace('/files', '/groups/files'),
      route.replace('45~6', 'abc'),
      route + '&preview=7',
    ])
      it(hostile, () => expect(fileTarget(hostile, origin)).toBeNull());
  }
});

describe('comment attachment routes', () => {
  const origin = 'https://school.edu';
  const route = '/courses/12~3/assignments/7/submissions/8~1';
  const tab = `${route}?comment_id=9~1&download=45~6`;
  it('turns the link into its canonical route', () => {
    expect(fileTarget(`${route}?download=45~6&comment_id=9~1&verifier=x`, origin)).toEqual({
      fileId: tab,
    });
    expect(
      fileTarget(
        '/courses/1/assignments/2/anonymous_submissions/aB12z?comment_id=3&download=4',
        origin,
      ),
    ).toEqual({
      fileId: '/courses/1/assignments/2/anonymous_submissions/aB12z?comment_id=3&download=4',
    });
  });
  it('names the route as a tab, and only that route', () => {
    expect(isTabId(tab)).toBe(true);
    expect(isCommentTab(tab)).toBe(true);
    expect(isTabId('45~6')).toBe(true);
    expect(isCommentTab('45~6')).toBe(false);
    for (const bad of [
      `https://evil.example${tab}`,
      `${tab}&x=1`,
      `${tab}#a`,
      tab.replace('comment_id=9~1&download=45~6', 'download=45~6&comment_id=9~1'),
      tab.replace('/submissions/8~1', '/submissions/8/extra'),
      tab.replace('/courses/12~3', '/groups/12'),
      tab.replace('comment_id=9~1', 'comment_id=x'),
      tab.replace('download=45~6', 'download=0'),
      `/files/45~6/download?comment_id=1&download=2`,
      `${route}?comment_id=1&download=2\n`,
    ])
      expect(isTabId(bad)).toBe(false);
  });
  it('rejects links that are not a clean comment attachment', () => {
    for (const bad of [
      'https://other.edu' + tab,
      `${route}/extra?download=4&comment_id=9`,
      `${route}?download=abc&comment_id=9`,
      `${route}?download=4&comment_id=abc`,
      `${route}?download=4&comment_id=1&comment_id=2`,
      `${route}?download=4&download=5&comment_id=1`,
      `/courses/1/assignments/2/submissions/3?download=4&comment_id=${'9'.repeat(21)}`,
    ])
      expect(fileTarget(bad, origin)).toBeNull();
  });
  it('keeps only the text of a link as its name', () => {
    expect(linkName('  Teacher\n feedback.pdf\u0000 ')).toBe('Teacher feedback.pdf');
    expect(linkName('a'.repeat(300))).toHaveLength(200);
    // A space at the cut goes, so the name is still clean and the channel takes it.
    const cut = linkName(`${'a'.repeat(199)} ${'b'.repeat(50)}`);
    expect(cut).toBe('a'.repeat(199));
    expect(linkName(cut ?? null)).toBe(cut);
    expect(linkName(' \n ')).toBeUndefined();
    expect(linkName(null)).toBeUndefined();
  });
  it('keeps a comment tab in the stored tabs and drops other addresses', () => {
    expect(
      normalizeTabs({ ids: [tab, '5', 'https://evil.example/x', `${tab}&a=1`], active: tab }),
    ).toEqual({
      ids: [tab, '5'],
      active: tab,
    });
    expect(openFile({ ids: [], active: null }, tab).active).toBe(tab);
    expect(openFile({ ids: [], active: null }, `${tab}&a=1`).active).toBeNull();
  });
});
