/**
 * The engine of the dashboard fixes (design decision 22).
 *
 * One `MutationObserver` watches the page for the whole feature. React draws the widgets again
 * when its data changes, which removes what a fix added to a node it replaced. After each batch of
 * changes, one pass runs every enabled fix, and each fix draws again only what is missing. The
 * observer ignores the changes that the fixes make themselves, so a pass does not start another.
 * A fix that is switched off removes what it added, and the page is as Canvas draws it.
 */
import { logFailure } from '../../../shared/platform/log';
import type { DashboardFixesSettings } from '../../../shared/settings/tools';
import type { DataMessage } from '../../weekly-list/data/protocol';
import type { DashboardData } from '../protocol';
import { announcementsFix } from './announcements';
import { courseColorsFix } from './colors';
import { isFixNode, type Fix, type FixContext } from './context';
import { courseWorkFix } from './courseWork';
import { gradesFix } from './grades';
import { findGradeWidgets } from '../../../shared/canvas/widgetDashboard';
import { FIXES_CSS } from './styles';

/** How long a batch of page changes waits for the next one. */
const BATCH_MS = 50;
const STYLE_ID = 'wr-dashboard-fixes';

export interface FixesEngineOptions {
  doc: Document;
  /** The origin of the page, which is the saved Canvas. */
  origin: string;
  send(message: DataMessage): Promise<unknown>;
}

export interface FixesEngine {
  /** Turns the engine on or off. It runs only on the saved Canvas. */
  setActive(active: boolean): void;
  /** The switches of the fixes. A fix that is off is removed. */
  setSettings(settings: DashboardFixesSettings): void;
  /** Loads the data again, for example after the background says that it changed. */
  reload(): void;
  /** Removes everything and stops. */
  stop(): void;
}

type FixKey = keyof DashboardFixesSettings;

/** Whether a change of the page concerns the fixes: it is not their own. */
function isForeign(records: readonly MutationRecord[]): boolean {
  return records.some((record) => {
    if (record.type === 'attributes') {
      return !(record.target instanceof Element && record.target.closest('[data-wr-own]'));
    }
    const nodes = [...record.addedNodes, ...record.removedNodes];
    if (nodes.length > 0 && nodes.every(isFixNode)) return false;
    return !(record.target instanceof Element && record.target.closest('[data-wr-own]'));
  });
}

export function createFixesEngine(options: FixesEngineOptions): FixesEngine {
  const { doc, origin } = options;
  const fixes: Record<FixKey, Fix> = {
    courseColors: courseColorsFix(),
    announcementsInPlace: announcementsFix(),
    courseWorkExtras: courseWorkFix(),
    allCourseGrades: gradesFix(),
  };
  const keys = Object.keys(fixes) as FixKey[];
  let settings: DashboardFixesSettings | null = null;
  let active = false;
  let stopped = false;
  let data: DashboardData | null = null;
  let observer: MutationObserver | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let style: HTMLStyleElement | null = null;
  let loadSeq = 0;
  let requestedVisibility = false;
  const blocks = new Map<string, string>();
  /** The fixes that have drawn something, so a switch-off knows which ones to undo. */
  const applied = new Set<FixKey>();

  function enabled(key: FixKey): boolean {
    return active && settings !== null && settings[key];
  }

  function anyEnabled(): boolean {
    return keys.some(enabled);
  }

  function renderCss(): void {
    if (!anyEnabled()) {
      style?.remove();
      style = null;
      return;
    }
    if (style === null) {
      style = doc.createElement('style');
      style.id = STYLE_ID;
      style.setAttribute('data-wr-own', 'style');
    }
    style.textContent = [FIXES_CSS, ...blocks.values()].join('\n');
    if (!style.isConnected) (doc.head ?? doc.documentElement).append(style);
  }

  const context: FixContext = {
    doc,
    origin,
    get data() {
      return data;
    },
    send: options.send,
    css(name, css) {
      if (css === null || css === '') blocks.delete(name);
      else blocks.set(name, css);
    },
    again: () => schedule(0),
  };

  /** Runs a step of one fix. A fix that fails never stops the others. */
  function guard(key: FixKey, step: () => void): void {
    try {
      step();
    } catch (error) {
      logFailure(`dashboard fix ${key}`, error);
    }
  }

  function run(): void {
    timer = null;
    if (enabled('allCourseGrades') && !requestedVisibility && findGradeWidgets(doc).length > 0)
      load();
    for (const key of keys) {
      if (enabled(key)) {
        applied.add(key);
        guard(key, () => fixes[key].apply(context));
      } else if (applied.delete(key)) {
        guard(key, () => fixes[key].remove());
      }
    }
    // The observer sees the changes of this pass as its own, so it does not ask for another.
    renderCss();
    observer?.takeRecords();
  }

  function schedule(ms: number): void {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(run, ms);
  }

  function watch(): void {
    if (anyEnabled()) {
      if (observer === null) {
        observer = new MutationObserver((records) => {
          if (isForeign(records)) schedule(BATCH_MS);
        });
        observer.observe(doc.body ?? doc.documentElement, {
          childList: true,
          subtree: true,
          // The inputs of the filters change their `value`, and the toggle of the grades its test id.
          attributes: true,
          attributeFilter: ['value', 'data-testid'],
        });
      }
    } else if (observer !== null) {
      observer.disconnect();
      observer = null;
    }
  }

  function update(): void {
    watch();
    schedule(0);
  }

  function load(): void {
    for (const key of applied) fixes[key].reload?.();
    const seq = (loadSeq += 1);
    if (!anyEnabled()) return;
    const includeGradeVisibility = enabled('allCourseGrades') && findGradeWidgets(doc).length > 0;
    requestedVisibility = includeGradeVisibility;
    options
      .send({
        type: 'weekrow:dashboard-data',
        ...(includeGradeVisibility ? { includeGradeVisibility: true } : {}),
      })
      .then((reply) => {
        if (seq !== loadSeq) return;
        const next = reply as DashboardData | undefined;
        if (typeof next?.origin !== 'string' || !Array.isArray(next.courses)) return;
        data = next;
        fixes.allCourseGrades.reload?.();
        schedule(0);
      })
      .catch((error: unknown) => logFailure('dashboard data', error));
  }

  return {
    setActive(next) {
      if (stopped || active === next) return;
      active = next;
      update();
      if (active) load();
    },
    setSettings(next) {
      if (stopped) return;
      const before = anyEnabled();
      settings = { ...next };
      update();
      if (!before && anyEnabled()) load();
    },
    reload: load,
    stop() {
      stopped = true;
      active = false;
      loadSeq += 1;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      observer?.disconnect();
      observer = null;
      for (const key of applied) guard(key, () => fixes[key].remove());
      applied.clear();
      blocks.clear();
      style?.remove();
      style = null;
    },
  };
}

/**
 * Removes what an earlier copy of the script left on the page: its nodes, its marks on the nodes
 * of Canvas and its stylesheet. Firefox destroys the context of a script when its extension
 * updates and then injects the new version, so the old copy cannot clean up after itself. Every
 * node and mark of the fixes starts with `data-wr-`.
 */
export function removeStaleFixes(doc: Document = document): void {
  doc.querySelectorAll('[data-wr-own]').forEach((node) => node.remove());
  for (const element of doc.querySelectorAll('*')) {
    for (const name of element.getAttributeNames()) {
      if (name.startsWith('data-wr-')) element.removeAttribute(name);
    }
  }
}
