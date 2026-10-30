import { describe, expect, it } from 'vitest';
import { buildReport } from './report';
import { emptyResults } from './run';
import { browserLabel } from './environment';
import type { CheckResults, ReportEnvironment } from './types';

const ENV: ReportEnvironment = {
  browser: 'Firefox 140.0',
  extensionVersion: '0.1.0.12',
  canvasHost: 'school.instructure.com',
  date: '2026-10-30',
};

/** A full set of results, with hostile text in every field that holds text. */
function hostile(): CheckResults {
  const secret = 'Alice-Smith-resume-SECRETVERIFIER';
  return {
    scan: {
      pagePath: '/courses/:id/files',
      kinds: [
        {
          kind: 'instructure_file_link',
          count: 3,
          sample: '/courses/:id/files/:id/download',
          hooks: ['a.instructure_file_link[data-api-endpoint]'],
        },
        { kind: 'files_href', count: 4, sample: null, hooks: [] },
        { kind: 'preview_button', count: 0, sample: null, hooks: [] },
        { kind: 'module_file_item', count: 1, sample: '/courses/:id/modules', hooks: [] },
        {
          kind: 'submission_attachment',
          count: 2,
          sample: '/courses/:id/assignments/:id/submissions',
          hooks: [],
        },
      ],
      fileId: '42',
      fileIdKind: 'instructure_file_link',
      metaCsp: "frame-src 'self'",
    },
    scanError: null,
    fileSource: 'page',
    api: {
      status: 200,
      error: null,
      contentType: 'application/json',
      size: 1234,
      fileContentType: 'application/pdf',
      hasUrl: true,
      hasPreviewUrl: false,
      url: { host: 'school.instructure.com', path: '/files/:id/download', sameOrigin: true },
      previewUrl: null,
    },
    background: {
      context: 'background',
      hops: [
        {
          host: 'school.instructure.com',
          path: '/files/:id/download',
          status: 0,
          kind: 'redirect',
          contentType: null,
        },
        {
          host: 'files.canvas-user-content.com',
          path: '/files',
          status: 200,
          kind: 'final',
          contentType: 'application/pdf',
        },
      ],
      redirected: true,
      responseType: 'cors',
      bytes: 1234,
      truncated: false,
      firstBytes: '%PDF-',
      pdfSignature: true,
      threw: null,
    },
    extensionPage: {
      context: 'extension page',
      hops: [],
      redirected: false,
      responseType: null,
      bytes: null,
      truncated: false,
      firstBytes: null,
      pdfSignature: null,
      threw: 'TypeError',
    },
    frame: {
      scheme: 'moz-extension',
      handshake: true,
      loadEvent: true,
      dynamicAddress: false,
      ms: 31,
      error: null,
    },
    head: {
      path: '/courses/:id/files',
      status: 200,
      error: null,
      csp: "frame-src 'self' https://x.example.com",
      cspReportOnly: null,
    },
    notes: [`note with a leak https://host.example.com/x?token=${secret} #${secret}`],
  };
}

describe('buildReport', () => {
  it('holds the browser, the extension version, the Canvas host and the results', () => {
    const report = buildReport(hostile(), ENV);
    expect(report).toContain('Browser: Firefox 140.0');
    expect(report).toContain('Extension version: 0.1.0.12');
    expect(report).toContain('Canvas host: school.instructure.com');
    expect(report).toContain(
      'a.instructure_file_link: 3 found, sample /courses/:id/files/:id/download',
    );
    expect(report).toContain('  hook: a.instructure_file_link[data-api-endpoint]');
    expect(report).toContain('GET /api/v1/files/:id: status 200');
    expect(report).toContain(
      'url: yes (school.instructure.com/files/:id/download, same origin as Canvas)',
    );
    expect(report).toContain('preview_url: no');
    expect(report).toContain(
      'hop 1 (redirect): school.instructure.com/files/:id/download, status 0 (opaque redirect)',
    );
    expect(report).toContain(
      'hop 2 (final): files.canvas-user-content.com/files, status 200, content-type application/pdf',
    );
    expect(report).toContain('first 5 bytes: %PDF-');
    expect(report).toContain('%PDF- signature: yes');
    expect(report).toContain('fetch threw: yes (TypeError)');
    expect(report).toContain(
      'Probe page in an iframe (moz-extension address): loaded, handshake answered',
    );
    expect(report).toContain("content-security-policy: frame-src 'self' https://x.example.com");
    expect(report).toContain('The hops between them are not visible.');
  });

  it('removes a query, a fragment and a long value that reached a note', () => {
    const report = buildReport(hostile(), ENV);
    expect(report).not.toMatch(/SECRET|Alice|token=/);
    expect(report).not.toMatch(/[?#]/);
  });

  it('says what did not run', () => {
    const report = buildReport(emptyResults(), ENV);
    expect(report).toContain('not run');
    expect(report).toContain('File id source: none');
    expect(report).toContain('From the background: not run');
    expect(report).toContain('Probe page in an iframe: not run');
    expect(report).toContain('HEAD of the page: not run');
  });

  it('shows a failed frame check', () => {
    const results = hostile();
    results.frame = {
      scheme: 'chrome-extension',
      handshake: false,
      loadEvent: false,
      dynamicAddress: false,
      ms: 3001,
      error: 'timeout',
    };
    expect(buildReport(results, ENV)).toContain('NOT loaded, no handshake');
  });

  it('writes no em dash', () => {
    expect(buildReport(hostile(), ENV)).not.toContain('—');
  });
});

describe('browserLabel', () => {
  it('reads the name and the version, and no system details', () => {
    expect(
      browserLabel('Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0'),
    ).toBe('Firefox 140.0');
    expect(
      browserLabel(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
      ),
    ).toBe('Chrome 144.0.0.0');
    expect(
      browserLabel(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36 Edg/144.0.2000.1',
      ),
    ).toBe('Edge 144.0.2000.1');
    expect(
      browserLabel(
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/144.0.0.0 Safari/537.36',
      ),
    ).toBe('Chrome 144.0.0.0');
    expect(browserLabel('curl/8')).toBe('unknown browser');
  });
});
