/**
 * The engine of the dashboard fixes (design decision 22).
 *
 * One `MutationObserver` watches the page for the whole feature. React draws the widgets again
 * when its data changes, which removes what a fix added to a node it replaced. After each batch of
 * changes, one pass runs every enabled fix, and each fix draws again only what is missing. The
 * observer ignores the changes that the fixes make themselves, so a pass does not start another.
 * A fix that is switched off removes what it added, and the page is as Canvas draws it.
 *
 * A grade card that the fix copied shows a grade only when a server read confirms it, and that
 * read must begin after the last moment the fix could have missed a change. The fix misses a
 * change while it is off or inactive, before the first data reply, and while the observer is
 * disconnected. At each of these moments every confirmation turns stale: the copies show dots,
 * and a fresh read begins. A read that began earlier never counts.
 */
import { logFailure } from '../../../shared/platform/log';
import type { DashboardFixesSettings } from '../../../shared/settings/tools';
import type { DataMessage } from '../../weekly-list/data/protocol';
import type { DashboardData } from '../protocol';
import { announcementsFix } from './announcements';
import { courseColorsFix } from './colors';
import { isFixNode, type Fix, type FixContext } from './context';
import { courseWorkFix } from './courseWork';
import { gradesFix, type GradeVisibilityStore } from './grades';
import { findGradeWidgets } from '../../../shared/canvas/widgetDashboard';
import { FIXES_CSS } from './styles';

/** How long a batch of page changes waits for the next one. */
const BATCH_MS = 50;
const VISIBILITY_REFRESH_MS = 30_000;
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
  const gradeStore: GradeVisibilityStore = { serverStates: new Map(), observed: new Map() };
  const fixes: Record<FixKey, Fix> = {
    courseColors: courseColorsFix(),
    announcementsInPlace: announcementsFix(),
    courseWorkExtras: courseWorkFix(),
    allCourseGrades: gradesFix(gradeStore),
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
  /** What the server confirmed for the confirmed student, or `null` while nothing is confirmed. */
  let visibility: DashboardData['gradeVisibilities'] = null;
  /** A read must begin: nothing is confirmed, or the page changed what a confirmation covers. */
  let wantRead = true;
  let reading = false;
  /** Counts the reads and the blind moments, so a read that began before one never counts. */
  let visibilitySeq = 0;
  /** Names the running or last read, so a late result can only go back to that read. */
  let readToken = '';
  let readCount = 0;
  let lastVisibilityRefresh = -Infinity;
  const engineId = Math.random().toString(36).slice(2);
  let toggleState = '';
  let nativeVisibility = new Map<string, boolean>();
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
    const widgets = findGradeWidgets(doc);
    const toggles = widgets
      .map((found) => `${found.widget.getAttribute('data-testid')}:${found.gradesHidden}`)
      .join(',');
    const nextNative = new Map<string, boolean>();
    for (const found of widgets) {
      for (const card of found.cards.filter((node) => !node.hasAttribute('data-wr-card'))) {
        const id = card.getAttribute('data-testid') ?? '';
        const grade = card.querySelector('[data-testid$="-grade"]');
        if (grade) nextNative.set(id, grade.textContent !== '•••');
      }
    }
    const configChanged =
      toggles === toggleState &&
      [...nextNative].some(
        ([id, visible]) => nativeVisibility.has(id) && nativeVisibility.get(id) !== visible,
      );
    if (enabled('allCourseGrades') && toggleState && (toggles !== toggleState || configChanged)) {
      wantRead = true;
    }
    toggleState = toggles;
    nativeVisibility = nextNative;
    // Before the apply loop, so the first draw of the copies already shows dots.
    if (
      enabled('allCourseGrades') &&
      wantRead &&
      gradeStore.userId !== undefined &&
      widgets.length > 0
    ) {
      startRead();
    }
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

  /**
   * The fix could have missed a change: no confirmation holds any more. The copies show dots, the
   * running read stops counting, and a fresh read is wanted.
   */
  function markBlind(): void {
    visibilitySeq += 1;
    readToken = '';
    reading = false;
    wantRead = true;
    visibility = null;
    gradeStore.observed.clear();
    gradeStore.serverStates.clear();
    toggleState = '';
    nativeVisibility = new Map();
    if (data) data = { ...data, gradeVisibilities: null };
  }

  /** Runs a change of the state and marks the fix blind when the grades fix switched on or off. */
  function changing(change: () => void): void {
    const before = enabled('allCourseGrades');
    change();
    if (before !== enabled('allCourseGrades')) markBlind();
  }

  function startRead(): void {
    wantRead = false;
    reading = true;
    const seq = ++visibilitySeq;
    readToken = `${engineId}-${++readCount}`;
    visibility = null;
    if (data) data = { ...data, gradeVisibilities: null };
    options
      .send({ type: 'weekrow:dashboard-data', includeGradeVisibility: true, readToken })
      .then((reply) => {
        if (stopped || seq !== visibilitySeq) return;
        reading = false;
        const result = reply as DashboardData | undefined;
        // A result counts only for the student that is confirmed now.
        const confirmed = result?.userId !== undefined && result.userId === gradeStore.userId;
        visibility = confirmed ? (result?.gradeVisibilities ?? null) : null;
        if (data) data = { ...data, gradeVisibilities: visibility };
        schedule(0);
      })
      .catch((error: unknown) => {
        if (seq === visibilitySeq) reading = false;
        logFailure('grade preferences', error);
      });
  }

  function onVisibilityChange(): void {
    if (
      stopped ||
      doc.visibilityState !== 'visible' ||
      !enabled('allCourseGrades') ||
      gradeStore.userId === undefined ||
      findGradeWidgets(doc).length === 0 ||
      Date.now() - lastVisibilityRefresh < VISIBILITY_REFRESH_MS
    )
      return;
    lastVisibilityRefresh = Date.now();
    startRead();
    schedule(0);
  }

  doc.addEventListener('visibilitychange', onVisibilityChange);

  function load(): void {
    for (const key of applied) {
      if (key !== 'allCourseGrades') fixes[key].reload?.();
    }
    const seq = (loadSeq += 1);
    if (!anyEnabled()) return;
    options
      .send({ type: 'weekrow:dashboard-data' })
      .then((reply) => {
        if (seq !== loadSeq) return;
        const next = reply as DashboardData | undefined;
        if (typeof next?.origin !== 'string' || !Array.isArray(next.courses)) return;
        // A reply without a user id is a failed sign-in check. It says nothing about the student.
        if (next.userId !== undefined && next.userId !== gradeStore.userId) {
          const changed = gradeStore.userId !== undefined;
          gradeStore.userId = next.userId;
          // What the page showed before a student was confirmed belongs to no confirmed student.
          if (changed) fixes.allCourseGrades.remove();
          markBlind();
        }
        // The result of a read that ended late counts only for the read that is the last one since
        // the last blind moment, and only for the confirmed student.
        if (
          next.gradeVisibilities != null &&
          !reading &&
          readToken !== '' &&
          next.visibilityToken === readToken &&
          next.userId === gradeStore.userId
        ) {
          visibility = next.gradeVisibilities;
        }
        // A read that ended with no result runs again when the data changes.
        if (visibility === null && !reading) wantRead = true;
        data = { ...next, gradeVisibilities: visibility };
        schedule(0);
      })
      .catch((error: unknown) => logFailure('dashboard data', error));
  }

  return {
    setActive(next) {
      if (stopped || active === next) return;
      changing(() => {
        active = next;
      });
      update();
      if (active) load();
    },
    setSettings(next) {
      if (stopped) return;
      const before = anyEnabled();
      changing(() => {
        settings = { ...next };
      });
      update();
      if (!before && anyEnabled()) load();
    },
    reload() {
      load();
    },
    stop() {
      stopped = true;
      doc.removeEventListener('visibilitychange', onVisibilityChange);
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
