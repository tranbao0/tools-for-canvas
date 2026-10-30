// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { normalizeScan, parseFileInput, scanPage } from './scan';
import { SCAN_KINDS } from './types';

afterEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

function count(scan: ReturnType<typeof normalizeScan>, kind: string): number {
  return scan.kinds.find((entry) => entry.kind === kind)?.count ?? -1;
}

describe('scanPage', () => {
  it('finds each kind of file link and the first file id', () => {
    document.body.innerHTML = `
      <p>Read <a class="instructure_file_link inline_disabled" data-api-endpoint="https://school.instructure.com/api/v1/courses/3/files/42" data-api-returntype="File"
        href="/courses/3/files/42/download?wrap=1&verifier=SECRETVERIFIER">Alice Smith resume.pdf</a></p>
      <a href="/courses/3/files/77?verifier=SECRETVERIFIER">Other</a>
      <a class="file_preview_link" href="/courses/3/files/42/preview">Preview</a>
      <ul><li class="context_module_item attachment"><a href="/courses/3/modules/items/9">Syllabus</a></li></ul>
      <a href="/courses/3/assignments/5/submissions/8?download=61">Submitted</a>
      <a href="/files/90/download?download_frd=1">Download</a>
      <a href="/attachments/12/download">Attachment</a>`;
    const scan = normalizeScan(scanPage());
    expect(count(scan, 'instructure_file_link')).toBe(1);
    expect(count(scan, 'files_href')).toBe(4);
    expect(count(scan, 'preview_button')).toBe(1);
    expect(count(scan, 'module_file_item')).toBe(1);
    expect(count(scan, 'submission_attachment')).toBe(3);
    expect(scan.kinds.find((entry) => entry.kind === 'instructure_file_link')?.sample).toBe(
      '/courses/:id/files/:id/download',
    );
    expect(scan.kinds.find((entry) => entry.kind === 'module_file_item')?.sample).toBe(
      '/courses/:id/modules/:id',
    );
    expect(scan.fileId).toBe('42');
    expect(scan.fileIdKind).toBe('instructure_file_link');
    expect(scan.kinds.find((entry) => entry.kind === 'instructure_file_link')?.hooks).toEqual([
      'a.instructure_file_link.inline_disabled[data-api-endpoint,data-api-returntype]',
    ]);
    const text = JSON.stringify(scan);
    expect(text).not.toMatch(/SECRET|verifier|Alice|resume|Syllabus/);
  });

  it('takes the file id from the download parameter of a submission link', () => {
    document.body.innerHTML = '<a href="/courses/3/assignments/5/submissions/8?download=61">x</a>';
    const scan = normalizeScan(scanPage());
    expect(scan.fileId).toBe('61');
    expect(scan.fileIdKind).toBe('submission_attachment');
  });

  it('finds nothing on a page without file links', () => {
    document.body.innerHTML = '<p>Nothing here</p><a href="/courses/3/grades">Grades</a>';
    const scan = normalizeScan(scanPage());
    expect(scan.kinds.map((entry) => entry.count)).toEqual([0, 0, 0, 0, 0]);
    expect(scan.fileId).toBeNull();
    expect(scan.metaCsp).toBeNull();
  });

  it('reads the meta tag policy and redacts its nonces and addresses', () => {
    document.head.innerHTML =
      '<meta http-equiv="Content-Security-Policy" content="frame-src https://a.example.com/Alice?token=1 \'nonce-abc123\'">';
    const scan = normalizeScan(scanPage());
    expect(scan.metaCsp).toBe("frame-src https://a.example.com 'nonce-REDACTED'");
  });

  it('keeps out class names that look like ids or are odd', () => {
    document.body.innerHTML =
      '<a class="instructure_file_link user-12345 Alice_Smith ok-name" href="/files/1">x</a>';
    const scan = normalizeScan(scanPage());
    expect(scan.kinds[0]?.hooks).toEqual(['a.instructure_file_link.ok-name']);
  });
});

describe('normalizeScan', () => {
  it('turns anything that is not a scan into an empty scan', () => {
    for (const raw of [null, undefined, 5, 'text', [], {}]) {
      const scan = normalizeScan(raw);
      expect(scan.kinds.map((entry) => entry.kind)).toEqual([...SCAN_KINDS]);
      expect(scan.kinds.every((entry) => entry.count === 0 && entry.sample === null)).toBe(true);
      expect(scan.fileId).toBeNull();
      expect(scan.pagePath).toBe('/');
    }
  });

  it('redacts a hostile page answer', () => {
    const scan = normalizeScan({
      pagePath: '/courses/5/files/Alice Smith resume.pdf',
      kinds: [
        {
          kind: 'files_href',
          count: 3,
          sample: '/courses/5/files/eyJhbGciOiJIUzI1NiJ9/Alice.pdf?verifier=SECRETVERIFIER',
          hooks: ['a[href=Alice]', 'a.ok', 42, 'x'.repeat(500)],
        },
        { kind: 'unknown_kind', count: 1, sample: '/Alice', hooks: [] },
      ],
      fileId: '12; DROP',
      fileIdKind: 'files_href',
      metaCsp: "default-src 'nonce-abc123' https://x.example.com/Alice?token=1",
    });
    expect(scan.pagePath).toBe('/courses/:id/files');
    expect(scan.kinds.find((entry) => entry.kind === 'files_href')).toEqual({
      kind: 'files_href',
      count: 3,
      sample: '/courses/:id/files',
      hooks: ['a.ok'],
    });
    expect(scan.fileId).toBeNull();
    expect(scan.fileIdKind).toBeNull();
    expect(scan.metaCsp).toBe("default-src 'nonce-REDACTED' https://x.example.com");
    expect(JSON.stringify(scan)).not.toMatch(/SECRET|Alice|abc123/);
  });

  it('rejects counts that are not whole numbers', () => {
    const scan = normalizeScan({
      kinds: [
        { kind: 'files_href', count: -1 },
        { kind: 'preview_button', count: 1.5 },
      ],
    });
    expect(scan.kinds.map((entry) => entry.count)).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('parseFileInput', () => {
  it('reads an id, a path or an address', () => {
    expect(parseFileInput(' 42 ')).toBe('42');
    expect(parseFileInput('12~345')).toBe('12~345');
    expect(parseFileInput('https://school.instructure.com/courses/3/files/42/download?x=1')).toBe(
      '42',
    );
    expect(parseFileInput('/files/42')).toBe('42');
    expect(parseFileInput('/files/42?download=1')).toBe('42');
  });

  it('refuses other text', () => {
    for (const text of ['', 'abc', '/courses/3', '42; DROP', '/files/abc', '12.5']) {
      expect(parseFileInput(text)).toBeNull();
    }
  });
});
