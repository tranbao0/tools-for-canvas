/**
 * The contract between the Preact views and the extension runtime.
 * Views are pure: they render props and call actions. They never call Canvas or browser APIs,
 * except `allowAccess`, which the runtime implements so that it runs inside the click handler.
 */
import type { Settings, SurfaceState } from '../model/types';

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
  /** Absolute week offset. 0 is the current week. */
  goToWeek(offset: number): void;
  /**
   * Moves by `delta` weeks from the week the student last asked for, not from the week on screen,
   * so quick clicks while a week loads are never lost.
   */
  stepWeek(delta: number): void;
  /** `undefined`: no filter. `null`: the Personal ring. */
  setCourseFilter(courseId: string | null | undefined): void;
  setDone(key: string, done: boolean): void;
  skip(key: string): void;
  unskip(key: string): void;
  skipAllOlder(): void;
  undo(): void;
  /** Closes the Undo notice. A pending task delete is sent then. */
  dismissUndo(): void;
  createTask(input: TaskInput): void;
  updateTask(noteId: string, input: TaskInput): void;
  deleteTask(noteId: string): void;
  moveTaskToToday(noteId: string): void;
  openItem(key: string): void;
  /**
   * Runs `permissions.request` at once, then checks the address and saves it when it is Canvas.
   * Call it directly from a click handler, with no await before it.
   */
  allowAccess(origin: string): void;
  /** Accept the "Use this Canvas?" or "Switch to this Canvas?" offer. */
  acceptOffer(origin: string): void;
  dismissOffer(): void;
  changeAddress(): void;
  /** Leaves a failed check of a new address and goes back to the saved address. */
  keepSavedAddress(): void;
  /** Opens the saved Canvas in a tab, for sign-in. */
  openCanvas(): void;
  retry(): void;
  /** Opens the extension's own settings page. The gear opens the settings in place instead. */
  openSettings(): void;
  /** Saves the settings shown in place in the panel or the in-page list. */
  saveSettings(settings: Settings): void;
  markNoteSeen(note: 'firstDone' | 'firstSkip'): void;
}

export interface AppProps {
  surface: SurfaceKind;
  state: SurfaceState;
  actions: Actions;
  /** The browser, so the first run can show the right pin steps. Defaults to 'chrome'. */
  browser?: 'chrome' | 'edge' | 'firefox';
  /** The keyboard shortcut for the toolbar button, if one is set. */
  shortcut?: string | null;
  /**
   * The data for the settings shown in place (decision 18). Missing until loaded; the gear then
   * shows a short loading state.
   */
  settings?: { value: Settings; courses: { id: string; name: string }[] };
}

export interface SettingsProps {
  settings: Settings;
  /** All active student courses, including hidden ones. */
  courses: { id: string; name: string }[];
  origin: string | null;
  onChange(settings: Settings): void;
  onChangeAddress(): void;
}

export interface WelcomeProps {
  browser: 'chrome' | 'edge' | 'firefox';
  /** The keyboard shortcut for the toolbar button, if one is set. */
  shortcut: string | null;
  state: SurfaceState;
  actions: Actions;
}
