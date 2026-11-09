// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  clickedElement,
  closeFile,
  PANEL_HOST_ATTRIBUTE,
  courseOfLink,
  fileTarget,
  keptAddress,
  isCommentTab,
  isTabId,
  linkName,
  normalizeTabs,
  applyTabIntent,
  openFile,
  isFileId,
  plainClick,
  isSubmissionPage,
  frameFileTarget,
  catchesDownload,
} from './model';
import { MAX_STORED_WIDTH, normalizeWidth } from './width';

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
  it('accepts only the id of a file', () => {
    expect(isFileId('42')).toBe(true);
    expect(isFileId('9~12345')).toBe(true);
    for (const value of [
      '/courses/12/files/42',
      'https://school.edu/files/42',
      '//other.edu/files/42',
      '/files/42?url=https://other.edu',
      '../files/42',
      {},
      null,
    ])
      expect(isFileId(value)).toBe(false);
  });
});
describe('width', () => {
  it('normalizes invalid and extreme values', () => {
    expect(normalizeWidth(null)).toBe(480);
    expect(normalizeWidth(NaN)).toBe(480);
    expect(normalizeWidth(100)).toBe(360);
    expect(normalizeWidth(10000, 1920)).toBe(1344);
    expect(normalizeWidth(1500, 2560)).toBe(1500);
    expect(normalizeWidth(99999)).toBe(MAX_STORED_WIDTH);
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
    // My Files of the student, and the Files page of a group and of a user.
    '/files/folder/users_9?preview=45~6',
    '/files?preview=45~6',
    '/files/search?search_term=a&preview=45~6',
    '/groups/5/files/folder/plans?preview=45~6',
    '/users/9/files?preview=45~6',
  ]) {
    it(route, () => expect(fileTarget(route, origin)).toEqual({ fileId: '45~6' }));
    for (const hostile of [
      'https://other.edu' + route,
      route.replace('/files', '/files/extra'),
      route.replace('/files', '/groups/files'),
      route.replace(/^(?:\/(?:courses|groups|users)\/[^/]+)?\/files/, '/accounts/1/files'),
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

describe('the address of a link that carries a verifier or a location', () => {
  const origin = 'https://school.edu';
  it('keeps the whole address of a link on the saved Canvas', () => {
    expect(keptAddress('/courses/9/files/5?verifier=abc', origin)).toBe(
      'https://school.edu/courses/9/files/5?verifier=abc',
    );
    expect(keptAddress(`${origin}/files/5/download?location=course_9`, origin)).toBe(
      'https://school.edu/files/5/download?location=course_9',
    );
  });
  it('keeps nothing for a link without either parameter', () => {
    expect(keptAddress('/courses/9/files/5', origin)).toBeUndefined();
    expect(keptAddress('/courses/9/files/5?download_frd=1', origin)).toBeUndefined();
  });
  it('keeps nothing for another origin, a script address or an address that is too long', () => {
    expect(keptAddress('https://evil.example/files/5?verifier=abc', origin)).toBeUndefined();
    expect(keptAddress('//evil.example/files/5?verifier=abc', origin)).toBeUndefined();
    expect(keptAddress('javascript:alert(1)//?verifier=abc', origin)).toBeUndefined();
    expect(keptAddress(`/files/5?verifier=${'a'.repeat(2100)}`, origin)).toBeUndefined();
  });
});

describe('stored inactive tabs', () => {
  it('keeps an explicit null with a nonempty list', () => {
    expect(normalizeTabs({ ids: ['42'], active: null })).toEqual({ ids: ['42'], active: null });
  });
  it('uses the first tab when active is missing', () => {
    expect(normalizeTabs({ ids: ['42'] })).toEqual({ ids: ['42'], active: '42' });
  });
  it('uses the first tab when active is unknown', () => {
    expect(normalizeTabs({ ids: ['42'], active: '99' })).toEqual({ ids: ['42'], active: '42' });
  });
});

it('restores an evicted tab at its old index', () => {
  expect(
    applyTabIntent({ ids: ['1', '3'], active: '3' }, {
      action: 'undo',
      added: ['3'],
      evicted: [{ id: '2', index: 1 }],
    } as never),
  ).toEqual({ ids: ['1', '2'], active: null });
});
