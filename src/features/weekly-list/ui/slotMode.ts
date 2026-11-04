/**
 * Whether the card sits in the Course work slot of the widget dashboard. The layout code marks
 * that with `data-panel="slot"` on the shadow host. The rows read the mode from this context,
 * because a slot row renders its parts in another order than a row on any other surface.
 */
import { createContext } from 'preact';

export const SlotModeContext = createContext(false);

/** Calls `onChange` with the mode now and after every change of the host's `data-panel`. */
export function watchSlotMode(host: HTMLElement, onChange: (slot: boolean) => void): () => void {
  const read = (): boolean => host.getAttribute('data-panel') === 'slot';
  const observer = new MutationObserver(() => onChange(read()));
  observer.observe(host, { attributes: true, attributeFilter: ['data-panel'] });
  onChange(read());
  return () => observer.disconnect();
}
