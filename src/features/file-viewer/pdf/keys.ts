/**
 * The keys of the PDF viewer (design decision 25). The handler runs in the pane page only, so the
 * keys never reach Canvas.
 */
export type PdfKeyAction =
  | 'previous-page'
  | 'next-page'
  | 'first-page'
  | 'last-page'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'
  | 'search';

/** Where the focus is. Some places keep their own use of the plain keys. */
export type KeyContext = 'none' | 'editable' | 'tablist' | 'menu';

export interface KeyInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  context: KeyContext;
}

/**
 * The action for a key, or `null` when the viewer leaves the key alone. Ctrl or Cmd with plus,
 * minus, 0 or F work everywhere in the pane, also in the search field. PageUp, PageDown, Home
 * and End work where the focus has no use for them: not in a field, the tab strip or a menu.
 */
export function pdfKeyAction(input: KeyInput): PdfKeyAction | null {
  if (input.altKey) return null;
  const command = input.ctrlKey || input.metaKey;
  if (command) {
    switch (input.key) {
      case '+':
      case '=':
        return 'zoom-in';
      case '-':
      case '_':
        return 'zoom-out';
      case '0':
        return 'zoom-reset';
      case 'f':
      case 'F':
        return input.shiftKey ? null : 'search';
      default:
        return null;
    }
  }
  if (input.shiftKey || input.context !== 'none') return null;
  switch (input.key) {
    case 'PageUp':
      return 'previous-page';
    case 'PageDown':
      return 'next-page';
    case 'Home':
      return 'first-page';
    case 'End':
      return 'last-page';
    default:
      return null;
  }
}

/** The key context of an element. */
export function keyContextOf(target: EventTarget | null): KeyContext {
  if (!(target instanceof Element)) return 'none';
  if (target.closest('input, textarea, select, [contenteditable="true"]')) return 'editable';
  if (target.closest('[role="tablist"]')) return 'tablist';
  if (target.closest('[role="menu"]')) return 'menu';
  return 'none';
}
