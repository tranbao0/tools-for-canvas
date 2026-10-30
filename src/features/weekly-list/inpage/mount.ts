/**
 * Waits for the mount condition of the page's adapter and creates the mount container.
 * See docs/design.md, decision 4, "In-page rules".
 */
import {
  MOUNT_CONTAINER_ID,
  createMountContainer,
  findCourseHomeAnchors,
  findDashboardAnchors,
  isAdapterPath,
} from './adapters';
import { dockWhenColumnScrolledPast } from './dock';
import { claimDashboardLayout, releaseLayout } from './layout';
import { showNativeTodo } from './nativeTodo';

/** What the mount callback gets. */
export interface InpageMount {
  /** Set on a course home page: the list shows only this course. */
  courseId: string | null;
  /**
   * The empty container. It starts as a sibling before `#right-side` inside `#right-side-wrapper`.
   * On the widget dashboard and in List View the layout moves it into the page content.
   */
  container: HTMLElement;
  /** Undoes what the mount changed in the page layout, other than the container. */
  release(): void;
}

export type MountCallback = (mount: InpageMount) => void;

/** How long to wait for the anchors. Canvas loads the dashboard sidebar after the page. */
export const DEFAULT_MOUNT_TIMEOUT_MS = 30_000;

export type MountOutcome =
  | { kind: 'mounted'; mount: InpageMount }
  /** No adapter applies to this path, for example a course assignments page. */
  | { kind: 'no_adapter' }
  /** The anchors did not appear in time, for example a classic dashboard whose sidebar never loads. */
  | { kind: 'timeout' }
  | { kind: 'cancelled' };

export interface MountOptions {
  doc?: Document;
  /** Defaults to the path of the document's window. */
  pathname?: string;
  timeoutMs?: number;
  /** Aborting stops the wait, for example WXT's `ctx.signal` when the content script ends. */
  signal?: AbortSignal;
}

/**
 * Removes a list that an earlier copy of the content script left on the page, and the style that
 * hides the native To Do and the layout it took. Returns whether a list was there.
 *
 * A copy that is still alive cleans up by itself: WXT invalidates it before a newer copy of the
 * same script runs. A copy whose context the browser destroyed cannot clean up. Firefox does this
 * on an extension update and then injects the new version into the open tabs, so without this
 * step the page would keep a frozen list and a hidden native To Do.
 */
export function removeStaleMount(doc: Document = document): boolean {
  const stale = [...doc.querySelectorAll(`#${MOUNT_CONTAINER_ID}`)];
  for (const node of stale) node.remove();
  releaseLayout(doc);
  showNativeTodo(doc);
  return stale.length > 0;
}

/**
 * Waits until the page meets the mount condition, then creates the container and calls
 * `onMount` once. A `MutationObserver` watches the page, and the wait ends after the timeout.
 * The promise tells what happened. Nothing is added to the page unless the outcome is `mounted`.
 * A list that an earlier copy of the script left behind is removed first (`removeStaleMount`).
 */
export function mountWhenReady(
  onMount: MountCallback,
  options: MountOptions = {},
): Promise<MountOutcome> {
  const doc = options.doc ?? document;
  if (options.signal?.aborted === true) return Promise.resolve({ kind: 'cancelled' });
  removeStaleMount(doc);
  const pathname = options.pathname ?? doc.defaultView?.location.pathname ?? '';
  if (!isAdapterPath(pathname)) return Promise.resolve({ kind: 'no_adapter' });

  return new Promise<MountOutcome>((resolve) => {
    let finished = false;
    const observer = new MutationObserver(() => tryMount());
    const timer = setTimeout(
      () => finish({ kind: 'timeout' }),
      options.timeoutMs ?? DEFAULT_MOUNT_TIMEOUT_MS,
    );
    const onAbort = (): void => finish({ kind: 'cancelled' });

    function finish(outcome: MountOutcome): void {
      if (finished) return;
      finished = true;
      observer.disconnect();
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      resolve(outcome);
    }

    function tryMount(): boolean {
      if (finished) return true;
      const found = findDashboardAnchors(pathname, doc) ?? findCourseHomeAnchors(pathname, doc);
      if (found === null) return false;
      const container = createMountContainer(doc, found.anchors);
      const mount: InpageMount = {
        courseId: found.courseId,
        container,
        release: found.claimsLayout
          ? claimDashboardLayout(doc, container)
          : dockWhenColumnScrolledPast(doc, container, found.anchors.wrapper),
      };
      finish({ kind: 'mounted', mount });
      onMount(mount);
      return true;
    }

    options.signal?.addEventListener('abort', onAbort);
    if (tryMount()) return;
    observer.observe(doc.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
  });
}
