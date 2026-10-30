/**
 * The page scan of the file access check. `scanPage` runs inside the Canvas tab, through
 * `scripting.executeScript`, so it holds all of its code and uses nothing outside itself. It
 * only reads the page. Its answer is data from a page, so `normalizeScan` checks every field and
 * redacts every path before the extension uses it.
 */
import { isCanvasId } from '../../shared/canvas/ids';
import { redactCsp, redactPath } from '../../shared/canvas/redact';
import { SCAN_KINDS, type KindSummary, type ScanKind, type ScanSummary } from './types';

/** What `scanPage` returns. Paths are not redacted yet. */
export interface RawScan {
  pagePath: string;
  kinds: { kind: string; count: number; sample: string | null; hooks: string[] }[];
  fileId: string | null;
  fileIdKind: string | null;
  metaCsp: string | null;
}

/**
 * Counts the file links and file elements of the page. Runs in the page. It must not use any
 * name from outside its own body.
 */
export function scanPage(): RawScan {
  const SELECTORS: [string, string][] = [
    ['instructure_file_link', 'a.instructure_file_link'],
    ['files_href', 'a[href*="/files/"]'],
    [
      'preview_button',
      'a.file_preview_link, a.preview_in_overlay, [data-canvas-previewable], [data-testid*="preview" i], a[href*="file_preview"], a[href*="/preview"], button[aria-label*="preview" i]',
    ],
    [
      'module_file_item',
      '.context_module_item.attachment a[href], li.attachment a[href], [data-item-type="attachment"] a[href]',
    ],
    [
      'submission_attachment',
      'a[href*="/submissions/"], a[href*="download_frd"], a[href*="/attachments/"]',
    ],
  ];
  const SAFE_NAME = /^[a-z][a-z0-9_-]{1,29}$/;
  const ID = '(\\d+(?:~\\d+)?)';
  const idPatterns = [new RegExp(`/files/${ID}(?:/|$)`), new RegExp(`/attachments/${ID}(?:/|$)`)];

  const pathOf = (href: string | null): string | null => {
    if (href === null || href === '') return null;
    try {
      return new URL(href, location.href).pathname.slice(0, 300);
    } catch {
      return null;
    }
  };
  const idOf = (element: Element): string | null => {
    const hrefs = [element.getAttribute('href'), element.getAttribute('data-api-endpoint')];
    for (const href of hrefs) {
      if (href === null) continue;
      let url: URL;
      try {
        url = new URL(href, location.href);
      } catch {
        continue;
      }
      for (const pattern of idPatterns) {
        const match = pattern.exec(url.pathname);
        if (match?.[1] !== undefined) return match[1];
      }
      const download = url.searchParams.get('download');
      if (url.pathname.includes('/submissions/') && download !== null && /^\d+$/.test(download)) {
        return download;
      }
    }
    return null;
  };
  const shapeOf = (element: Element): string => {
    const classes = [...element.classList].filter(
      (name) => SAFE_NAME.test(name) && !/\d{3}/.test(name),
    );
    const data = element
      .getAttributeNames()
      .filter((name) => name.startsWith('data-') && SAFE_NAME.test(name));
    const tag = element.tagName.toLowerCase().replace(/[^a-z0-9-]/g, '');
    return `${tag}${classes
      .slice(0, 6)
      .map((name) => `.${name}`)
      .join('')}${data.length > 0 ? `[${data.slice(0, 6).join(',')}]` : ''}`;
  };

  let fileId: string | null = null;
  let fileIdKind: string | null = null;
  const kinds = SELECTORS.map(([kind, selector]) => {
    let elements: Element[];
    try {
      elements = [...document.querySelectorAll(selector)];
    } catch {
      elements = [];
    }
    let sample: string | null = null;
    const hooks: string[] = [];
    for (const element of elements) {
      sample ??= pathOf(element.getAttribute('href'));
      const shape = shapeOf(element);
      if (hooks.length < 3 && !hooks.includes(shape)) hooks.push(shape);
      if (fileId === null) {
        const id = idOf(element);
        if (id !== null) {
          fileId = id;
          fileIdKind = kind;
        }
      }
    }
    return { kind, count: Math.min(elements.length, 99999), sample, hooks };
  });
  const meta = document.querySelector('meta[http-equiv=Content-Security-Policy]');
  return {
    pagePath: location.pathname.slice(0, 300),
    kinds,
    fileId,
    fileIdKind,
    metaCsp: meta?.getAttribute('content')?.slice(0, 6000) ?? null,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const SHAPE = /^[a-z0-9-]{1,20}(?:\.[a-z][a-z0-9_-]{1,29}){0,6}(?:\[[a-z0-9_,-]{0,300}\])?$/;

function isScanKind(value: unknown): value is ScanKind {
  return SCAN_KINDS.includes(value as ScanKind);
}

/** Checks the answer of `scanPage` and redacts it. Anything that is not valid becomes empty. */
export function normalizeScan(raw: unknown): ScanSummary {
  const input = isObject(raw) ? raw : {};
  const rawKinds = Array.isArray(input['kinds']) ? (input['kinds'] as unknown[]) : [];
  const kinds: KindSummary[] = SCAN_KINDS.map((kind) => {
    const found = rawKinds.find((entry) => isObject(entry) && entry['kind'] === kind);
    const entry = isObject(found) ? found : {};
    const count = entry['count'];
    const sample = entry['sample'];
    const hooks = Array.isArray(entry['hooks']) ? (entry['hooks'] as unknown[]) : [];
    return {
      kind,
      count: typeof count === 'number' && Number.isInteger(count) && count >= 0 ? count : 0,
      sample: typeof sample === 'string' ? redactPath(sample) : null,
      hooks: hooks
        .filter((hook): hook is string => typeof hook === 'string' && SHAPE.test(hook))
        .slice(0, 3),
    };
  });
  const fileId = input['fileId'];
  const fileIdKind = input['fileIdKind'];
  const metaCsp = input['metaCsp'];
  const pagePath = input['pagePath'];
  const idOk = isCanvasId(fileId);
  return {
    pagePath: typeof pagePath === 'string' ? redactPath(pagePath) : '/',
    kinds,
    fileId: idOk ? fileId : null,
    fileIdKind: idOk && isScanKind(fileIdKind) ? fileIdKind : null,
    metaCsp: typeof metaCsp === 'string' ? redactCsp(metaCsp) : null,
  };
}

/** A file id from text the student pasted: an id, or an address or path with `/files/<id>`. */
export function parseFileInput(text: string): string | null {
  const trimmed = text.trim();
  if (/^\d+(?:~\d+)?$/.test(trimmed)) return trimmed;
  const bare = trimmed.split(/[?#]/)[0] ?? '';
  const match = /\/files\/(\d+(?:~\d+)?)(?:\/|$)/.exec(bare);
  return match?.[1] ?? null;
}
