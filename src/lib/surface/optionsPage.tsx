/**
 * The settings page. See docs/design.md, decisions 18 and 19.
 */
import { render } from 'preact';
import { browser } from 'wxt/browser';
import { isCoursesReply, type CourseChoice } from '../data/protocol';
import type { Settings } from '../model/types';
import { logFailure } from '../platform/log';
import { canvasOriginItem, settingsItem } from '../platform/storage';
import { SettingsView } from '../ui/SettingsView';
import { installStyles } from '../ui/styles';
import { sendToBackground } from './hosts';
import { followExtensionPageTheme } from './theme';

async function loadCourses(): Promise<CourseChoice[]> {
  const reply = await sendToBackground({ type: 'weekrow:courses' });
  return isCoursesReply(reply) ? reply.courses : [];
}

/** The settings page. A change saves the settings, then asks the background to refresh. */
export async function startOptions(root: HTMLElement): Promise<void> {
  installStyles(document);
  followExtensionPageTheme(settingsItem, [document.documentElement, root], logFailure);
  let settings: Settings = await settingsItem.getValue();
  let origin: string | null = await canvasOriginItem.getValue();
  let courses: CourseChoice[] = [];

  const onChange = (next: Settings): void => {
    settings = next;
    draw();
    settingsItem
      .setValue(next)
      .then(() =>
        sendToBackground({ type: 'weekrow:refresh', reason: 'settings', surface: 'page' }),
      )
      .catch((error: unknown) => logFailure('save settings', error));
  };
  // The welcome page shows the address form, with the saved address kept as a way back.
  const onChangeAddress = (): void => {
    sendToBackground({ type: 'weekrow:change-address' })
      .then(() => browser.tabs.create({ url: browser.runtime.getURL('/welcome.html') }))
      .catch((error: unknown) => logFailure('change address', error));
  };
  const draw = (): void =>
    render(
      <SettingsView
        settings={settings}
        courses={courses}
        origin={origin}
        onChange={onChange}
        onChangeAddress={onChangeAddress}
      />,
      root,
    );
  const refreshCourses = (): void => {
    loadCourses()
      .then((list) => {
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
  draw();
  refreshCourses();
}
