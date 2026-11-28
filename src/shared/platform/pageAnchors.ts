// Reports whether the parser added the anchors by the time parsing ends.
export function waitForPageAnchors(
  doc: Document,
  hasAnchors: () => boolean,
  done: (found: boolean) => void,
): (() => void) | undefined {
  const found = hasAnchors();
  if (found || doc.readyState !== 'loading') {
    done(found);
    return;
  }

  const observer = new MutationObserver(() => check());
  function cancel(): void {
    observer.disconnect();
    doc.removeEventListener('readystatechange', check);
    doc.removeEventListener('DOMContentLoaded', check);
  }
  function check(event?: Event): void {
    const found = hasAnchors();
    if (!found && doc.readyState === 'loading' && event?.type !== 'DOMContentLoaded') return;
    cancel();
    done(found);
  }
  observer.observe(doc.documentElement, { childList: true, subtree: true });
  doc.addEventListener('readystatechange', check);
  doc.addEventListener('DOMContentLoaded', check);
  return cancel;
}
