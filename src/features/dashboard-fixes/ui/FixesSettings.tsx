/**
 * The settings group "New dashboard fixes" (design decision 22): one switch for each fix.
 * It shows in the same three places as the other settings.
 */
import { useState } from 'preact/hooks';
import { t, type MessageKey } from '../../../shared/ui/i18n';
import { Heading, newIds, Switch, type HeadingLevel } from '../../../shared/ui/parts';
import type { DashboardFixesSettings, ToolsSettings } from '../../../shared/settings/tools';

const SWITCHES: readonly [keyof DashboardFixesSettings, MessageKey][] = [
  ['courseColors', 'fixCourseColors'],
  ['announcementsInPlace', 'fixAnnouncements'],
  ['courseWorkExtras', 'fixCourseWork'],
  ['allCourseGrades', 'fixCourseGrades'],
];

export function FixesSettings(props: {
  tools: ToolsSettings;
  level: HeadingLevel;
  onChange(tools: ToolsSettings): void;
}) {
  const { tools } = props;
  const [ids] = useState(() => newIds('fix', ['group', ...SWITCHES.map(([key]) => key)]));
  return (
    <section class="wr-setting" aria-labelledby={ids['group']}>
      <Heading level={props.level} class="wr-setting-name" id={ids['group']}>
        {t('settingFixes')}
      </Heading>
      <p class="wr-setting-help">{t('fixesHelp')}</p>
      <ul class="wr-course-list">
        {SWITCHES.map(([key, label]) => (
          <li key={key}>
            <label for={ids[key]}>{t(label)}</label>
            <Switch
              id={ids[key] ?? key}
              checked={tools.dashboardFixes[key]}
              onChange={(checked) =>
                props.onChange({
                  ...tools,
                  dashboardFixes: { ...tools.dashboardFixes, [key]: checked },
                })
              }
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
