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
}

export interface ToolsSettings {
  dashboardFixes: DashboardFixesSettings;
}

export const DASHBOARD_FIX_KEYS = [
  'courseColors',
  'announcementsInPlace',
  'courseWorkExtras',
  'allCourseGrades',
] as const satisfies readonly (keyof DashboardFixesSettings)[];

export const DEFAULT_TOOLS_SETTINGS: ToolsSettings = {
  dashboardFixes: {
    courseColors: true,
    announcementsInPlace: true,
    courseWorkExtras: true,
    allCourseGrades: true,
  },
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
  return { dashboardFixes: fixes };
}

/** Whether the value has the exact shape of the tools settings, with every field valid. */
export function isToolsSettings(value: unknown): value is ToolsSettings {
  return JSON.stringify(normalizeToolsSettings(value)) === JSON.stringify(value);
}
