/**
 * The settings page. See docs/design.md, decisions 18 and 19.
 */
import { render } from 'preact';
import type { CourseChoice, StateReply } from '../data/protocol';
import type { Settings } from '../model/types';
import { logFailure } from '../platform/log';
import { canvasOriginItem, changeMarkerItem, settingsItem, watchItems } from '../platform/storage';
import { SettingsView } from '../ui/SettingsView';
import { PAGE_LAYOUT_CSS } from '../ui/pageLayout';
import { installStyles } from '../ui/styles';
import { sendToBackground } from './hosts';
import { followExtensionPageTheme } from './theme';

/** The courses in the state of the saved Canvas, or `null` while the state has none. */
async function loadCourses(): Promise<CourseChoice[] | null> {
  const state = (await sendToBackground({
    type: 'weekrow:get-state',
    request: { surface: 'page', weekOffset: 0, scopeCourseId: null },
  })) as StateReply | undefined;
  return state?.kind === 'ready' || state?.kind === 'no_courses' ? state.allCourses : null;
}

/** The settings page. A change saves the settings, then asks the background to refresh. */
export async function startOptions(root: HTMLElement): Promise<void> {
  installStyles(document, PAGE_LAYOUT_CSS);
  followExtensionPageTheme(settingsItem, [document.documentElement, root], logFailure);
  let settings: Settings = await settingsItem.getValue();
  let origin: string | null = await canvasOriginItem.getValue();
  let courses: CourseChoice[] = [];
  /** Counts the course requests, so only the newest answer counts. */
  let coursesSeq = 0;

  const onChange = (next: Settings): void => {
    settings = next;
    draw();
    settingsItem
      .setValue(next)
      .then(() => sendToBackground({ type: 'weekrow:refresh', reason: 'settings' }))
      .catch((error: unknown) => logFailure('save settings', error));
  };
  const draw = (): void =>
    render(
      <SettingsView settings={settings} courses={courses} origin={origin} onChange={onChange} />,
      root,
    );
  // The list comes with the state, which is not ready until the first round has loaded it. The
  // change marker asks again when it has. Other states keep the last list.
  const refreshCourses = (): void => {
    coursesSeq += 1;
    const seq = coursesSeq;
    loadCourses()
      .then((list) => {
        if (seq !== coursesSeq || list === null) return;
        courses = list;
        draw();
      })
      .catch((error: unknown) => logFailure('course list', error));
  };

  settingsItem.watch((value) => {
    settings = value;
    draw();
  });
  canvasOriginItem.watch((value) => {
    origin = value;
    courses = [];
    draw();
    refreshCourses();
  });
  watchItems([changeMarkerItem], refreshCourses);
  draw();
  refreshCourses();
}
