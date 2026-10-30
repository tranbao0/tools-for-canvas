/** The extension's settings page: the six settings and the Canvas address (design decision 18). */
import { useState } from 'preact/hooks';
import { t } from '../../../shared/ui/i18n';
import type { SettingsProps } from './contract';
import { hostOf } from './format';
import { AppMark } from '../../../shared/ui/icons';
import { HostText, newId } from '../../../shared/ui/parts';
import { SettingsFields } from './Settings';

export function SettingsView({
  settings,
  tools,
  onToolsChange,
  courses,
  origin,
  onChange,
}: SettingsProps) {
  const [addressId] = useState(() => newId('address'));
  return (
    <div class="wr" data-surface="page">
      <main class="wr-page">
        <header class="wr-page-head">
          <AppMark size={32} />
          <h1 class="wr-page-title">{t('settingsTitle')}</h1>
        </header>
        <SettingsFields
          settings={settings}
          courses={courses}
          level={2}
          onChange={onChange}
          tools={tools}
          onToolsChange={onToolsChange}
        />
        <section class="wr-setting wr-address" aria-labelledby={addressId}>
          <h2 class="wr-setting-name" id={addressId}>
            {t('settingAddress')}
          </h2>
          {origin ? (
            <HostText class="wr-address-value" host={hostOf(origin)} />
          ) : (
            <p class="wr-setting-help">{t('addressNotSet')}</p>
          )}
          <p class="wr-setting-help">{t('addressHelp')}</p>
        </section>
      </main>
    </div>
  );
}
