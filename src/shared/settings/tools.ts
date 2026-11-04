import { normalizeWidth } from '../../features/file-viewer/model';
/**
 * The settings of the small tools, one switch for each fix. See docs/design.md, decisions 18
 * and 22.
 *
 * Each tool is a group of switches under its own key, so a future tool adds a group here and
 * nothing else changes in how the settings are stored, checked and sent. The group of a tool
 * that is off keeps its fixes off. Every switch is on by default.
 *
 * This file holds no storage code, so the in-page script can import it (scripts/check-storage.mjs
 * keeps the storage out of the page scripts). The stored item is in toolsItem.ts.
 */

/** The fixes for the new widget dashboard (decision 22). */
export interface DashboardFixesSettings {
  /** The course color on the icons of the Course work widget. */
  courseColors: boolean;
  /** "Read more" opens the announcement in the card, and the course filter. */
  announcementsInPlace: boolean;
  /** The "Also due" section under the Course work list. */
  courseWorkExtras: boolean;
  /** A grade card for every course in the Course grades widget. */
  allCourseGrades: boolean;
  /** One fixed page navigator for the paged widgets. */
  steadyPager: boolean;
}

export interface ToolsSettings {
  fileViewer: boolean;
  fileViewerWidth: number;
  dashboardFixes: DashboardFixesSettings;
  /** The Submission Details view and the expand rows of the Assignments list (decision 26). */
  assignmentView: boolean;
}

export const DASHBOARD_FIX_KEYS = [
  'courseColors',
  'announcementsInPlace',
  'courseWorkExtras',
  'allCourseGrades',
  'steadyPager',
] as const satisfies readonly (keyof DashboardFixesSettings)[];

export const DEFAULT_TOOLS_SETTINGS: ToolsSettings = {
  fileViewer: true,
  fileViewerWidth: normalizeWidth(undefined),
  dashboardFixes: {
    courseColors: true,
    announcementsInPlace: true,
    courseWorkExtras: true,
    allCourseGrades: true,
    steadyPager: true,
  },
  assignmentView: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Complete, valid tools settings from a stored value. A missing or invalid field takes its
 * default, field by field, so one bad field changes nothing else. Other keys are dropped.
 */
export function normalizeToolsSettings(stored: unknown): ToolsSettings {
  const group =
    isRecord(stored) && isRecord(stored['dashboardFixes']) ? stored['dashboardFixes'] : {};
  const fixes = { ...DEFAULT_TOOLS_SETTINGS.dashboardFixes };
  for (const key of DASHBOARD_FIX_KEYS) {
    if (typeof group[key] === 'boolean') fixes[key] = group[key];
  }
  return {
    fileViewer:
      isRecord(stored) && typeof stored['fileViewer'] === 'boolean' ? stored['fileViewer'] : true,
    fileViewerWidth: normalizeWidth(isRecord(stored) ? stored['fileViewerWidth'] : undefined),
    dashboardFixes: fixes,
    assignmentView:
      isRecord(stored) && typeof stored['assignmentView'] === 'boolean'
        ? stored['assignmentView']
        : true,
  };
}

/** Whether the value has the exact shape of the tools settings, with every field valid. */
export function isToolsSettings(value: unknown): value is ToolsSettings {
  return JSON.stringify(normalizeToolsSettings(value)) === JSON.stringify(value);
}
