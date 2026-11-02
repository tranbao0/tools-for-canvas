/**
 * The next tab for a key in a tab list, or `null` when the key does nothing. The arrows wrap
 * around; Home and End go to the first and last tab. A tab activates as soon as it gets focus.
 */
export function tabKeyTarget(key: string, index: number, count: number): number | null {
  if (count < 1) return null;
  switch (key) {
    case 'ArrowRight':
      return (index + 1) % count;
    case 'ArrowLeft':
      return (index + count - 1) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
