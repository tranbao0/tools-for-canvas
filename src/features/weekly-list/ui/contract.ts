/**
 * The contract between the Preact views and the extension runtime.
 * Views are pure: they render props and call actions. They never call Canvas or browser APIs,
 * except `allowAccess`, which the runtime implements so that it runs inside the click handler.
 */
import type { ToolsSettings } from '../../../shared/settings/tools';
import type { Settings, SurfaceState } from '../model/types';
import type { AnnouncementFeed, ListTab } from '../data/announcements';

export type SurfaceKind = 'panel' | 'inpage';

export interface TaskInput {
  title: string;
  /** Plain date in the Canvas time zone. */
  date: string;
  /** `HH:MM`, or `null` for no time (stored as 11:59 pm). */
  time: string | null;
  courseId: string | null;
  details: string | null;
}

export interface Actions {
  /** Absolute span offset. 0 is the span that holds today. */
  goToSpan(offset: number): void;
  /**
   * Moves by `delta` spans from the span the student last asked for, not from the span on screen,
   * so quick clicks while a span loads are never lost.
   */
  stepSpan(delta: number): void;
  /** `undefined`: no filter. `null`: the Personal ring. */
  setCourseFilter(courseId: string | null | undefined): void;
  setDone(key: string, done: boolean): void;
  skip(key: string): void;
  unskip(key: string): void;
  skipAllOlder(): void;
  undo(): void;
  /** Closes the Undo notice. A pending task delete is sent then. */
  dismissUndo(): void;
  /** Resolves with whether Canvas saved the task. The form waits for it. */
  createTask(input: TaskInput): Promise<boolean>;
  updateTask(noteId: string, input: TaskInput): void;
  deleteTask(noteId: string): void;
  moveTaskToToday(noteId: string): void;
  openItem(key: string): void;
  /**
   * Runs `permissions.request` for the saved Canvas at once, for a browser that withholds
   * access. Call it directly from a click handler, with no await before it.
   */
  allowAccess(origin: string): void;
  /** Accept the "Use this Canvas?" or "Switch to this Canvas?" offer. */
  acceptOffer(origin: string): void;
  dismissOffer(): void;
  /** Opens the saved Canvas in a tab, for sign-in. */
  openCanvas(): void;
  retry(): void;
  /** Saves the settings shown in place in the panel or the in-page list. */
  saveSettings(settings: Settings): void;
  /** Saves the switches of the small tools shown in place (decision 22). */
  saveTools(tools: ToolsSettings): void;
  markNoteSeen(note: 'firstDone' | 'firstSkip'): void;
  /** Shows the Tasks or the Announcements tab, and keeps the choice for the session. */
  setListTab(tab: ListTab): void;
  /** Shows or hides the announcements that the student has read. */
  setShowRead(show: boolean): void;
  /**
   * Marks an announcement as read. Only this explicit action writes a read state (design
   * decision 24). An Undo notice follows.
   */
  markAnnouncementRead(courseId: string, topicId: string): void;
  /**
   * The full message of an announcement, as HTML that a teacher wrote, or `null` when it did not
   * load. Loading it does not mark the announcement as read.
   */
  loadAnnouncementMessage(courseId: string, topicId: string): Promise<string | null>;
  /** Opens the announcement page in Canvas. Canvas marks the announcement as read there. */
  openAnnouncement(courseId: string, topicId: string): void;
  /** Loads the announcements again, after a failed load. */
  retryAnnouncements(): void;
}

/** The Announcements tab of a surface (design decision 24). */
export interface AnnouncementsProps {
  tab: ListTab;
  /** `null` until the first reply. */
  feed: AnnouncementFeed | null;
  showRead: boolean;
}

export interface AppProps {
  surface: SurfaceKind;
  state: SurfaceState;
  actions: Actions;
  /**
   * Set on a surface that shows the Tasks and Announcements tabs: the side panel, the classic
   * dashboard, List View and course home pages. Missing on the new widget dashboard, which has
   * its own Announcements widget.
   */
  announcements?: AnnouncementsProps;
  /**
   * The data for the settings shown in place (decision 18). Missing until loaded; the gear then
   * shows a short loading state.
   */
  settings?: {
    value: Settings;
    courses: { id: string; name: string }[];
    /** The switches of the small tools. Missing until they load: the group then stays out. */
    tools?: ToolsSettings;
  };
}

export interface SettingsProps {
  settings: Settings;
  /** The switches of the small tools, and how to save them. */
  tools: ToolsSettings;
  onToolsChange(tools: ToolsSettings): void;
  /** All active student courses, including hidden ones. */
  courses: { id: string; name: string }[];
  origin: string | null;
  onChange(settings: Settings): void;
}

export interface WelcomeProps {
  browser: 'chrome' | 'edge' | 'firefox';
  /** The keyboard shortcut for the toolbar button, if one is set. */
  shortcut: string | null;
  state: SurfaceState;
  actions: Actions;
}
