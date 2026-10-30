/**
 * The settings (design decision 18). The same five settings show in three places: in the side
 * panel and in the in-page list, where the gear opens them in place with a Back button, and on
 * the extension's own settings page (SettingsView), which also shows the Canvas address.
 */
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { t, type MessageKey } from '../../../shared/ui/i18n';
import { FixesSettings } from '../../dashboard-fixes/ui/FixesSettings';
import type { ToolsSettings } from '../../../shared/settings/tools';
import type { Settings } from '../model/types';
import type { AppProps } from './contract';
import { ChevronLeftIcon } from '../../../shared/ui/icons';
import { Heading, newIds, Switch, type HeadingLevel } from '../../../shared/ui/parts';
import { SpanPicker } from './SpanPicker';
import { Spinner } from './States';

const THEMES: [Settings['theme'], MessageKey][] = [
  ['auto', 'themeAuto'],
  ['light', 'themeLight'],
  ['dark', 'themeDark'],
];

export function parseTheme(value: string): Settings['theme'] {
  return value === 'light' || value === 'dark' ? value : 'auto';
}

/** The stored list of hidden course ids after the student shows or hides one course. */
export function toggleHidden(hidden: string[], courseId: string, hide: boolean): string[] {
  const without = hidden.filter((id) => id !== courseId);
  return hide ? [...without, courseId] : without;
}

/** The five settings. `level` is the heading level of the settings that have a heading. */
export function SettingsFields(props: {
  settings: Settings;
  courses: { id: string; name: string }[];
  level: HeadingLevel;
  onChange(settings: Settings): void;
  /** The switches of the small tools. Without them, their group stays out. */
  tools?: ToolsSettings;
  onToolsChange?(tools: ToolsSettings): void;
}) {
  const { settings, courses } = props;
  const [ids] = useState(() =>
    newIds('set', ['span', 'courses', 'rings', 'canvas', 'canvasHelp', 'theme', 'themeHelp']),
  );
  const update = (patch: Partial<Settings>) => props.onChange({ ...settings, ...patch });

  return (
    <div class="wr-settings">
      <div class="wr-setting">
        <label class="wr-setting-name" for={ids.span}>
          {t('settingSpan')}
        </label>
        <SpanPicker
          span={settings.span}
          selectId={ids.span}
          onChange={(span) => update({ span })}
        />
      </div>

      <section class="wr-setting" aria-labelledby={ids.courses}>
        <Heading level={props.level} class="wr-setting-name" id={ids.courses}>
          {t('settingCourses')}
        </Heading>
        <p class="wr-setting-help">{t('coursesHelp')}</p>
        {courses.length === 0 ? (
          <p class="wr-setting-help">{t('noCoursesYet')}</p>
        ) : (
          <ul class="wr-course-list">
            {courses.map((course) => {
              const id = `${ids.courses}-${course.id}`;
              return (
                <li key={course.id}>
                  <label for={id}>{course.name}</label>
                  <Switch
                    id={id}
                    checked={!settings.hiddenCourseIds.includes(course.id)}
                    label={t('showCourse', course.name)}
                    onChange={(show) =>
                      update({
                        hiddenCourseIds: toggleHidden(settings.hiddenCourseIds, course.id, !show),
                      })
                    }
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div class="wr-setting wr-setting-row">
        <label class="wr-setting-name" for={ids.rings}>
          {t('settingShowRings')}
        </label>
        <Switch
          id={ids.rings}
          checked={settings.showRings}
          onChange={(showRings) => update({ showRings })}
        />
      </div>

      <div class="wr-setting wr-setting-row">
        <label class="wr-setting-name" for={ids.canvas}>
          {t('settingShowOnCanvas')}
        </label>
        <Switch
          id={ids.canvas}
          checked={settings.showOnCanvasPages}
          describedBy={ids.canvasHelp}
          onChange={(showOnCanvasPages) => update({ showOnCanvasPages })}
        />
        <p class="wr-setting-help" id={ids.canvasHelp}>
          {t('showOnCanvasHelp')}
        </p>
      </div>

      <div class="wr-setting">
        <label class="wr-setting-name" for={ids.theme}>
          {t('settingTheme')}
        </label>
        <select
          id={ids.theme}
          class="wr-input"
          aria-describedby={ids.themeHelp}
          value={settings.theme}
          onChange={(event) => update({ theme: parseTheme(event.currentTarget.value) })}
        >
          {THEMES.map(([value, label]) => (
            <option key={value} value={value}>
              {t(label)}
            </option>
          ))}
        </select>
        <p class="wr-setting-help" id={ids.themeHelp}>
          {t('themeHelp')}
        </p>
      </div>

      {props.tools && props.onToolsChange && (
        <FixesSettings tools={props.tools} level={props.level} onChange={props.onToolsChange} />
      )}
    </div>
  );
}

/**
 * The settings in place, in the side panel or the in-page list. A change shows at once and goes
 * to `onChange`; a new value from the runtime replaces it. A short loading line shows until the
 * settings arrive. Escape and the Back button return to the list.
 */
export function SettingsPanel(props: {
  data: AppProps['settings'];
  level: HeadingLevel;
  onChange(settings: Settings): void;
  onToolsChange(tools: ToolsSettings): void;
  onBack(): void;
}) {
  const { data } = props;
  const rootRef = useRef<HTMLElement>(null);
  const [edit, setEdit] = useState<{ base: Settings; value: Settings } | null>(null);
  const [toolsEdit, setToolsEdit] = useState<{ base: ToolsSettings; value: ToolsSettings } | null>(
    null,
  );
  const shown = data && edit?.base === data.value ? edit.value : data?.value;
  const shownTools = data?.tools && toolsEdit?.base === data.tools ? toolsEdit.value : data?.tools;

  useLayoutEffect(() => {
    rootRef.current?.querySelector<HTMLElement>('[data-part="settings-head"]')?.focus();
  }, []);

  return (
    <section
      ref={rootRef}
      class="wr-settings-panel"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          props.onBack();
        }
      }}
    >
      <div class="wr-head">
        <Heading level={props.level} class="wr-range" part="settings-head" tabIndex={-1}>
          {t('settings')}
        </Heading>
        <button type="button" class="wr-icon-btn wr-back" data-part="back" onClick={props.onBack}>
          <ChevronLeftIcon />
          {t('back')}
        </button>
      </div>
      {data && shown ? (
        <SettingsFields
          settings={shown}
          courses={data.courses}
          level={Math.min(props.level + 1, 4) as HeadingLevel}
          onChange={(next) => {
            setEdit({ base: data.value, value: next });
            props.onChange(next);
          }}
          tools={shownTools}
          onToolsChange={(next) => {
            if (data.tools) setToolsEdit({ base: data.tools, value: next });
            props.onToolsChange(next);
          }}
        />
      ) : (
        <div class="wr-state">
          <Spinner text={t('settingsLoading')} />
        </div>
      )}
    </section>
  );
}
