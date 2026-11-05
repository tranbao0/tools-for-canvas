// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { isAssignmentsList, isPaneFramePage, paneFileTarget } from './model';

const ORIGIN = 'https://school.edu';

describe('isAssignmentsList', () => {
  it('takes the Assignments list of a course, with a plain or a shard id', () => {
    expect(isAssignmentsList('/courses/12/assignments')).toBe(true);
    expect(isAssignmentsList('/courses/12/assignments/')).toBe(true);
    expect(isAssignmentsList('/courses/5~120/assignments')).toBe(true);
  });
  it.each([
    '/courses/12/assignments/101',
    '/courses/12/assignments/syllabus',
    '/courses/12',
    '/courses/0/assignments',
    '/courses/12/assignments/x/y',
    '/courses/12x/assignments',
  ])('refuses %s', (path) => {
    expect(isAssignmentsList(path)).toBe(false);
  });
});

describe('isPaneFramePage', () => {
  const list = '/courses/12/assignments';

  it('takes a page of the same course with content_only=1', () => {
    expect(isPaneFramePage(list, '/courses/12/assignments/101', '?content_only=1')).toBe(true);
    expect(isPaneFramePage(list, '/courses/12/discussion_topics/9', '?x=1&content_only=1')).toBe(
      true,
    );
    expect(isPaneFramePage(list, '/courses/12/quizzes/7', '?content_only=1')).toBe(true);
    expect(isPaneFramePage(list, '/courses/12', '?content_only=1')).toBe(true);
  });
  it('compares shard ids as decimal global ids', () => {
    expect(isPaneFramePage('/courses/12/assignments', '/courses/12/pages/a', '?content_only=1')).toBe(
      true,
    );
    expect(
      isPaneFramePage(
        '/courses/5~120/assignments',
        '/courses/50000000000120/assignments/3',
        '?content_only=1',
      ),
    ).toBe(true);
  });
  it.each([
    ['without the parameter', list, '/courses/12/assignments/101', ''],
    ['with another value', list, '/courses/12/assignments/101', '?content_only=0'],
    ['with the value twice', list, '/courses/12/assignments/101', '?content_only=0&content_only=1'],
    ['of another course', list, '/courses/13/assignments/101', '?content_only=1'],
    ['of no course', list, '/files/4', '?content_only=1'],
    ['with an id that is no id', list, '/courses/12x/assignments/101', '?content_only=1'],
    ['under a top page that is no list', '/courses/12/modules', '/courses/12/pages/a', '?content_only=1'],
    ['under an assignment page', '/courses/12/assignments/101', '/courses/12/pages/a', '?content_only=1'],
  ])('refuses a page %s', (_name, top, frame, search) => {
    expect(isPaneFramePage(top, frame, search)).toBe(false);
  });
});

describe('paneFileTarget', () => {
  const PAGE = '/courses/12/assignments/101';
  const link = (html: string) => {
    document.body.innerHTML = html;
    return document.body.firstElementChild!;
  };

  it('takes the links that the top frame takes, as a file id', () => {
    for (const [href, fileId] of [
      [`${ORIGIN}/courses/12/files/42?wrap=1`, '42'],
      [`${ORIGIN}/files/43/download?download_frd=1`, '43'],
      [`${ORIGIN}/courses/12/files?preview=44`, '44'],
      [`${ORIGIN}${PAGE}/submissions/7?download=45`, '45'],
    ] as const) {
      const a = link(`<a href="${href}">f</a>`);
      expect(paneFileTarget(a, href, ORIGIN, PAGE)).toEqual({ fileId });
    }
  });
  it('refuses a comment attachment, a module item, a page, another site and a button', () => {
    for (const href of [
      `${ORIGIN}${PAGE}/submissions/7?comment_id=1&download=45`,
      `${ORIGIN}/courses/12/modules/items/9`,
      `${ORIGIN}/courses/12/pages/intro`,
      'https://other.example/files/42',
    ]) {
      const a = link(`<a href="${href}">f</a>`);
      expect(paneFileTarget(a, href, ORIGIN, PAGE)).toBeNull();
    }
    const button = link('<button data-file-id="42">f</button>');
    expect(paneFileTarget(button, `${ORIGIN}/files/42`, ORIGIN, PAGE)).toBeNull();
  });
  it('lets a download attribute keep its action, except for a file that the student handed in', () => {
    const plain = link(`<a href="${ORIGIN}/files/42/download" download>f</a>`);
    expect(paneFileTarget(plain, `${ORIGIN}/files/42/download`, ORIGIN, PAGE)).toBeNull();
    document.body.innerHTML = `<aside id="right-side"><div class="details"><div class="content"><a id="mine" href="${PAGE}/submissions/7?download=45" download>f</a></div></div></aside>`;
    const mine = document.getElementById('mine')!;
    expect(
      paneFileTarget(mine, `${ORIGIN}${PAGE}/submissions/7?download=45`, ORIGIN, PAGE),
    ).toEqual({ fileId: '45' });
    expect(
      paneFileTarget(mine, `${ORIGIN}${PAGE}/submissions/7?download=45`, ORIGIN, '/courses/12/pages/a'),
    ).toBeNull();
  });
});
