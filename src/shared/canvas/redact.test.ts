import { describe, expect, it } from 'vitest';
import {
  describeUrl,
  escapeBytes,
  mediaType,
  redactCsp,
  redactPath,
  redactUrl,
  scrubReport,
} from './redact';

/** Text that must never reach a report. */
const SECRETS = [
  'SECRETVERIFIER',
  'Alice',
  'Smith',
  'resume',
  'eyJhbGciOiJIUzI1NiJ9',
  'sessiontoken',
  'hunter2',
  'nonce-abc123',
  'sha256-AbCdEf',
];

function expectClean(text: string): void {
  for (const secret of SECRETS) expect(text).not.toContain(secret);
  expect(text).not.toMatch(/[?#]/);
  expect(text).not.toMatch(/token=|verifier=|download_frd/);
}

describe('redactPath', () => {
  it('keeps structural words and turns ids into :id', () => {
    expect(redactPath('/courses/123/files/456/download')).toBe('/courses/:id/files/:id/download');
    expect(redactPath('/api/v1/files/9~12345')).toBe('/api/v1/files/:id');
    expect(redactPath('/courses/1/modules/2')).toBe('/courses/:id/modules/:id');
    expect(redactPath('/courses/1/assignments/2/submissions/3')).toBe(
      '/courses/:id/assignments/:id/submissions/:id',
    );
  });

  it('drops every segment that is not a structural word', () => {
    expect(redactPath('/courses/12/files/Alice%20Smith%20resume.pdf')).toBe('/courses/:id/files');
    expect(redactPath('/users/Alice/files/12/preview')).toBe('/files/:id/preview');
    expect(redactPath('/files/eyJhbGciOiJIUzI1NiJ9/resume.pdf')).toBe('/files');
    expect(redactPath('/attachments/77/download')).toBe('/:id/download');
  });

  it('removes the query and the fragment', () => {
    expect(redactPath('/files/1/download?download_frd=1&verifier=SECRETVERIFIER')).toBe(
      '/files/:id/download',
    );
    expect(redactPath('/files/1#Alice-Smith')).toBe('/files/:id');
    expect(redactPath('/files/Alice?x=/files/1')).toBe('/files');
  });

  it('does not let a name pass through an unusual separator, case or encoding', () => {
    expect(redactPath('/courses\\Alice\\files')).toBe('/courses/files');
    expect(redactPath('/Courses/1/FILES/Alice')).toBe('/:id');
    expect(redactPath('/files;jsessionid=sessiontoken/1')).toBe('/:id');
    expect(redactPath('/%66iles/1')).toBe('/:id');
    expect(redactPath('//files//1//')).toBe('/files/:id');
    expect(redactPath('/files/../Alice/./1')).toBe('/files/:id');
    expect(redactPath('')).toBe('/');
    expect(redactPath('?token=sessiontoken')).toBe('/');
  });

  it('stops at 12 segments', () => {
    const long = `/${Array.from({ length: 40 }, () => 'files').join('/')}`;
    expect(redactPath(long).split('/').length).toBe(13);
  });
});

describe('redactUrl and describeUrl', () => {
  const corpus = [
    'https://school.instructure.com/files/12/download?download_frd=1&verifier=SECRETVERIFIER',
    'https://school.instructure.com/courses/5/files/Alice-Smith-resume.pdf?verifier=SECRETVERIFIER#hunter2',
    'https://user:hunter2@school.instructure.com/files/1',
    'https://inst-fs-iad-prod.inscloudgate.net/files/eyJhbGciOiJIUzI1NiJ9/resume.pdf?token=eyJhbGciOiJIUzI1NiJ9&download=1',
    'https://school.instructure.com:8443/files/1/download?sessiontoken=1',
    'https://x.canvas-user-content.com/Alice/Smith/resume.pdf?verifier=SECRETVERIFIER',
    '/files/12/download?verifier=SECRETVERIFIER',
    'https://school.instructure.com/files/1%2FAlice%2Fresume',
    'https://school.instructure.com/files/1/download;verifier=SECRETVERIFIER',
  ];

  it('never shows a query, a token, a user name or a name', () => {
    for (const address of corpus) {
      expectClean(describeUrl(address, 'https://school.instructure.com'));
    }
  });

  it('keeps the host and the structural path', () => {
    expect(redactUrl(corpus[0] ?? '')).toEqual({
      host: 'school.instructure.com',
      path: '/files/:id/download',
    });
    expect(describeUrl(corpus[3] ?? '')).toBe('inst-fs-iad-prod.inscloudgate.net/files');
    expect(redactUrl(corpus[2] ?? '')?.host).toBe('school.instructure.com');
    expect(redactUrl(corpus[4] ?? '')?.host).toBe('school.instructure.com:8443');
  });

  it('shows only the scheme of an address that is not http or https', () => {
    expect(redactUrl('data:text/plain,Alice-Smith-hunter2')).toEqual({ host: '(data)', path: '/' });
    expect(redactUrl('blob:https://school.instructure.com/abc-Alice')?.host).toBe('(blob)');
    expect(redactUrl('javascript:alert(Alice)')?.host).toBe('(javascript)');
  });

  it('answers null or a marker for text that is not an address', () => {
    expect(redactUrl('http://')).toBeNull();
    expect(describeUrl('http://')).toBe('(not an address)');
  });
});

describe('mediaType', () => {
  it('drops the parameters and rejects odd values', () => {
    expect(mediaType('application/pdf; charset=binary; name="Alice Smith.pdf"')).toBe(
      'application/pdf',
    );
    expect(mediaType('Text/HTML')).toBe('text/html');
    expect(mediaType('Alice Smith')).toBe('(unusual)');
    expect(mediaType(null)).toBeNull();
    expect(mediaType('')).toBeNull();
    expect(mediaType(5)).toBeNull();
  });
});

describe('escapeBytes', () => {
  it('shows printable bytes as text and the others as escapes', () => {
    expect(escapeBytes(new TextEncoder().encode('%PDF-'))).toBe('%PDF-');
    expect(escapeBytes(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x5c]))).toBe('PK\\x03\\x04\\\\');
    expect(escapeBytes(new Uint8Array([0xff, 0x00, 0x7f]))).toBe('\\xff\\x00\\x7f');
    expect(escapeBytes(new Uint8Array())).toBe('');
  });
});

describe('redactCsp', () => {
  it('removes nonces and hashes', () => {
    const csp =
      "script-src 'self' 'nonce-abc123' 'sha256-AbCdEf=' 'unsafe-inline'; style-src 'self' 'sha512-AbCdEf'";
    const out = redactCsp(csp);
    expectClean(out);
    expect(out).toContain("script-src 'self' 'nonce-REDACTED' 'hash-REDACTED' 'unsafe-inline'");
  });

  it('keeps the host of a source and drops its path and query', () => {
    const out = redactCsp(
      'frame-src https://*.instructure.com https://files.example.com/Alice/Smith/resume?token=sessiontoken data: blob: *.canvas-user-content.com:443/Alice',
    );
    expectClean(out);
    expect(out).toContain('https://*.instructure.com');
    expect(out).toContain('https://files.example.com');
    expect(out).toContain('data: blob: *.canvas-user-content.com:443');
  });

  it('removes the address and the group of a report directive', () => {
    const out = redactCsp(
      "default-src 'self'; report-uri https://reports.example.com/r/Alice/hunter2?token=sessiontoken; report-to Alice-group",
    );
    expectClean(out);
    expect(out).toContain('report-uri https://reports.example.com');
    expect(out).toContain('report-to');
    expect(out).not.toContain('group');
  });

  it('handles odd input', () => {
    expect(redactCsp('')).toBe('');
    expect(redactCsp(';;; ')).toBe('');
    expect(redactCsp("Alice Smith's policy; frame-src 'Alice'")).toBe("frame-src 'REDACTED'");
    expect(redactCsp(`default-src ${'a.com '.repeat(2000)}`).length).toBeLessThan(3100);
    expect(redactCsp('frame-src https://user:hunter2@host.example.com/x')).not.toContain('hunter2');
  });
});

describe('scrubReport', () => {
  it('removes queries, fragments, user names and long opaque values', () => {
    const text = [
      'url https://user:hunter2@host.example.com/files/1?verifier=SECRETVERIFIER#Alice',
      'jwt eyJhbGciOiJIUzI1NiJ9eyJzdWIiOiJBbGljZSJ9abcdefghijklmnop',
      'ok /courses/:id/files and 12345',
    ].join('\n');
    const out = scrubReport(text);
    expectClean(out);
    expect(out).toContain('ok /courses/:id/files and 12345');
    expect(out).toContain('[long value removed]');
  });

  it('keeps a long label of lower case words', () => {
    expect(scrubReport('content-security-policy-report-only: none')).toBe(
      'content-security-policy-report-only: none',
    );
  });
});
