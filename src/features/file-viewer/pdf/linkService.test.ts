// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { PdfLinkService, makeInternalLinksInert, safeExternalUrl } from './linkService';
import type { PdfDocument } from './types';

describe('safeExternalUrl', () => {
  it('lets http and https addresses through', () => {
    expect(safeExternalUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(safeExternalUrl('http://example.com')).toBe('http://example.com/');
  });

  it('refuses every other kind of address', () => {
    for (const value of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'blob:https://example.com/x',
      'ftp://example.com',
      'chrome-extension://abc/viewer.html',
      'moz-extension://abc/viewer.html',
      'mailto:a@example.com',
      '/relative/path',
      '',
      null,
      undefined,
      42,
    ]) {
      expect(safeExternalUrl(value), String(value)).toBeNull();
    }
  });
});

function setup(count = 5, current = 3) {
  const goToPage = vi.fn();
  const state = { pageCount: count, currentPage: current, goToPage };
  const doc = {
    getDestination: vi.fn(async (name: string) =>
      name === 'chapter' ? [{ num: 9, gen: 0 }, { name: 'Fit' }] : null,
    ),
    getPageIndex: vi.fn(async () => 1),
  } as unknown as PdfDocument;
  return { service: new PdfLinkService(state, () => doc), goToPage, doc };
}

describe('PdfLinkService', () => {
  it('opens an external link in a new tab with noopener', () => {
    const { service } = setup();
    const link = document.createElement('a');
    service.addLinkAttributes(link, 'https://example.com/x');
    expect(link.getAttribute('href')).toBe('https://example.com/x');
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
    expect(link.rel).toContain('noreferrer');
  });

  it('leaves a link that is not http or https without an address', () => {
    const { service } = setup();
    const link = document.createElement('a');
    link.setAttribute('href', 'javascript:alert(1)');
    service.addLinkAttributes(link, 'javascript:alert(1)');
    expect(link.hasAttribute('href')).toBe(false);
    expect(link.target).toBe('');
  });

  it('keeps the page address for internal links', () => {
    const { service } = setup();
    expect(service.getDestinationHash()).toBe('#');
    expect(service.getAnchorUrl()).toBe('#');
  });

  it('goes to the page of an explicit destination with a page reference', async () => {
    const { service, goToPage, doc } = setup();
    await service.goToDestination([{ num: 5, gen: 0 }, { name: 'Fit' }]);
    expect(doc.getPageIndex).toHaveBeenCalledWith({ num: 5, gen: 0 });
    expect(goToPage).toHaveBeenCalledWith(2);
  });

  it('goes to the page of an explicit destination with a page index', async () => {
    const { service, goToPage } = setup();
    await service.goToDestination([3, { name: 'XYZ' }, 0, 0, null]);
    expect(goToPage).toHaveBeenCalledWith(4);
  });

  it('resolves a named destination', async () => {
    const { service, goToPage, doc } = setup();
    await service.goToDestination('chapter');
    expect(doc.getDestination).toHaveBeenCalledWith('chapter');
    expect(goToPage).toHaveBeenCalledWith(2);
  });

  it('ignores a destination that does not exist or points outside the document', async () => {
    const { service, goToPage } = setup(3);
    await service.goToDestination('missing');
    await service.goToDestination(null);
    await service.goToDestination([99, { name: 'Fit' }]);
    await service.goToDestination([-1, { name: 'Fit' }]);
    await service.goToDestination([]);
    await service.goToDestination(['text']);
    expect(goToPage).not.toHaveBeenCalled();
  });

  it('does nothing when the document lookup fails', async () => {
    const goToPage = vi.fn();
    const doc = {
      getDestination: vi.fn(async () => {
        throw new Error('broken');
      }),
    } as unknown as PdfDocument;
    const service = new PdfLinkService({ pageCount: 3, currentPage: 1, goToPage }, () => doc);
    await expect(service.goToDestination('x')).resolves.toBeUndefined();
    expect(goToPage).not.toHaveBeenCalled();
  });

  it('runs the named page actions', () => {
    const { service, goToPage } = setup(5, 3);
    service.executeNamedAction('NextPage');
    service.executeNamedAction('PrevPage');
    service.executeNamedAction('FirstPage');
    service.executeNamedAction('LastPage');
    service.executeNamedAction('Print');
    service.executeNamedAction('GoBack');
    expect(goToPage.mock.calls).toEqual([[4], [2], [1], [5]]);
  });

  it('does not step past the first or last page', () => {
    const first = setup(5, 1);
    first.service.executeNamedAction('PrevPage');
    expect(first.goToPage).not.toHaveBeenCalled();
    const last = setup(5, 5);
    last.service.executeNamedAction('NextPage');
    expect(last.goToPage).not.toHaveBeenCalled();
  });

  it('has the methods that the annotation layer can call, and they do nothing', async () => {
    const { service } = setup();
    expect(service.externalLinkEnabled).toBe(true);
    expect(service.eventBus).toBeUndefined();
    expect(await service.getAttachmentContent()).toBeNull();
    expect(() => service.executeSetOCGState()).not.toThrow();
  });
});

describe('makeInternalLinksInert', () => {
  function layer() {
    const root = document.createElement('div');
    root.innerHTML =
      '<section><a href="#"></a></section><section><a href="https://example.com/x" target="_blank"></a></section>';
    const [internal, external] = root.querySelectorAll('a') as unknown as HTMLAnchorElement[];
    return { root, internal: internal!, external: external! };
  }

  it('takes the address from an internal link, so a middle click has nothing to open', () => {
    const { root, internal, external } = layer();
    makeInternalLinksInert(root);
    expect(internal.hasAttribute('href')).toBe(false);
    expect(internal.getAttribute('role')).toBe('link');
    expect(internal.tabIndex).toBe(0);
    expect(external.getAttribute('href')).toBe('https://example.com/x');
    expect(external.hasAttribute('role')).toBe(false);
  });

  it('keeps the click and the Enter key working', () => {
    const { root, internal } = layer();
    const clicked = vi.fn();
    internal.onclick = () => {
      clicked();
      return false;
    };
    makeInternalLinksInert(root);
    internal.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    expect(clicked).toHaveBeenCalledTimes(1);
    internal.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(clicked).toHaveBeenCalledTimes(1);
    internal.click();
    expect(clicked).toHaveBeenCalledTimes(2);
  });
});
