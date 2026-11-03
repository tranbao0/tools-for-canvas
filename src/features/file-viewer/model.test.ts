// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  clickedElement,
  closeFile,
  PANEL_HOST_ATTRIBUTE,
  courseOfLink,
  fileTarget,
  openFile,
  normalizeWidth,
  validRequest,
  plainClick,
  isSubmissionPage,
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
    expect(fileTarget(path + '?download=42&comment_id=1', 'https://school.edu')).toBeNull();
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

describe('submission links on a course with a shard id', () => {
  it('takes the file of a submission link whose course, assignment and user ids have a shard', () => {
    expect(
      fileTarget(
        '/courses/12~345/assignments/6~78/submissions/9~10?download=42',
        'https://school.instructure.com',
      ),
    ).toEqual({ fileId: '42' });
  });

  it('still refuses a comment attachment and a path with a bad id', () => {
    const origin = 'https://school.instructure.com';
    expect(
      fileTarget('/courses/12~345/assignments/6/submissions/9?download=42&comment_id=3', origin),
    ).toBeNull();
    expect(fileTarget('/courses/12~/assignments/6/submissions/9?download=42', origin)).toBeNull();
    expect(fileTarget('/courses/1~2~3/assignments/6/submissions/9?download=42', origin)).toBeNull();
  });
});
