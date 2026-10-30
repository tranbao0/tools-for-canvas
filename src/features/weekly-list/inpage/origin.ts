/**
 * Which Canvas the in-page script serves. See docs/design.md, decision 5.
 *
 * The background injects the script into a page of the saved address only, and the script mounts
 * only when the page origin equals the saved address. It never saves the address itself.
 */

/** Whether the page belongs to the saved Canvas. */
export function isSavedCanvasOrigin(pageOrigin: string, savedOrigin: string | null): boolean {
  return savedOrigin !== null && pageOrigin === savedOrigin;
}
