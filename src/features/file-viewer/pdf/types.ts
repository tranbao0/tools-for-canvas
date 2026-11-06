/**
 * Types of PDF.js (design decision 25). The library loads at run time from the extension's own
 * files (`pdfjs/pdf.min.mjs`), so only types come from the package.
 */
import type * as Pdfjs from 'pdfjs-dist';

/** The module that the loader returns. */
export type PdfjsLib = typeof Pdfjs;
export type PdfDocument = Pdfjs.PDFDocumentProxy;
export type PdfPage = Pdfjs.PDFPageProxy;
export type PdfRenderTask = Pdfjs.RenderTask;
