/**
 * The link service for the annotation layer of PDF.js (design decision 25). The layer draws only
 * links. An external link opens in a new tab with `noopener`. An internal destination scrolls to
 * its page. The service has every method the layer can call, so a link of any kind is safe.
 */
import type { PdfDocument } from './types';

/** The address of an external link, or `null` when the viewer does not open it. Only http and https open. */
export function safeExternalUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

/** What the link service needs from the viewer. */
export interface LinkTarget {
  pageCount: number;
  currentPage: number;
  goToPage(page: number): void;
}

/** A destination of PDF.js: a name, or an explicit array whose first item is a page. */
export type Destination = string | unknown[] | null;

export class PdfLinkService {
  readonly externalLinkEnabled = true;
  /** The layer reads this to send events. The viewer has none. */
  readonly eventBus = undefined;

  constructor(
    private readonly target: LinkTarget,
    private readonly getDocument: () => PdfDocument | undefined,
  ) {}

  addLinkAttributes(link: HTMLAnchorElement, url: unknown): void {
    const safe = safeExternalUrl(url);
    if (safe === null) {
      // A link that the viewer does not open stays on the page and does nothing.
      link.removeAttribute('href');
      return;
    }
    link.href = safe;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }

  getDestinationHash(): string {
    return '#';
  }

  getAnchorUrl(): string {
    return '#';
  }

  async goToDestination(destination: Destination): Promise<void> {
    const doc = this.getDocument();
    if (!doc || destination === null) return;
    try {
      const explicit =
        typeof destination === 'string' ? await doc.getDestination(destination) : destination;
      if (!Array.isArray(explicit)) return;
      const first: unknown = explicit[0];
      let index: number;
      if (typeof first === 'number' && Number.isInteger(first)) {
        index = first;
      } else if (typeof first === 'object' && first !== null) {
        index = await doc.getPageIndex(first as Parameters<PdfDocument['getPageIndex']>[0]);
      } else {
        return;
      }
      if (index >= 0 && index < this.target.pageCount) this.target.goToPage(index + 1);
    } catch {
      // A broken destination does nothing.
    }
  }

  executeNamedAction(action: string): void {
    const { currentPage, pageCount } = this.target;
    switch (action) {
      case 'NextPage':
        if (currentPage < pageCount) this.target.goToPage(currentPage + 1);
        break;
      case 'PrevPage':
        if (currentPage > 1) this.target.goToPage(currentPage - 1);
        break;
      case 'FirstPage':
        this.target.goToPage(1);
        break;
      case 'LastPage':
        this.target.goToPage(pageCount);
        break;
      default:
        break;
    }
  }

  getAttachmentContent(): Promise<null> {
    return Promise.resolve(null);
  }

  executeSetOCGState(): void {}
}
