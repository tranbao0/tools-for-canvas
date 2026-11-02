/**
 * Loads PDF.js when the first PDF tab opens (design decision 25). The build copies the library
 * and its worker, unmodified, to `pdfjs/` in the extension. The pane page imports the library
 * from its own extension address, so no other page carries it and no address leaves the
 * extension. The worker runs from the extension's own files too.
 */
import { browser } from 'wxt/browser';
import type { PdfjsLib } from './types';

export const PDFJS_MODULE = '/pdfjs/pdf.min.mjs';
export const PDFJS_WORKER = '/pdfjs/pdf.worker.min.mjs';
/** The folder of the image decoders, with a slash at the end. */
export const PDFJS_WASM_FOLDER = '/pdfjs/wasm/';

export const pdfjsDecoderUrl = (): string => extensionUrl(PDFJS_WASM_FOLDER);

const extensionUrl = (path: string): string => browser.runtime.getURL(path as never);

let loading: Promise<PdfjsLib> | undefined;

/** Loads the library once. A failed load can be tried again. */
export function loadPdfjs(): Promise<PdfjsLib> {
  loading ??= import(/* @vite-ignore */ extensionUrl(PDFJS_MODULE)).then((module: PdfjsLib) => {
    module.GlobalWorkerOptions.workerSrc = extensionUrl(PDFJS_WORKER);
    return module;
  });
  loading.catch(() => {
    loading = undefined;
  });
  return loading;
}
