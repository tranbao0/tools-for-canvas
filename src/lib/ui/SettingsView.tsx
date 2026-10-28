/** The extension's settings page: the five settings and the Canvas address (design decision 18). */
import { useState } from 'preact/hooks';
import { t } from '../i18n';
import type { SettingsProps } from './contract';
import { hostOf } from './format';
import { AppMark } from './icons';
import { PageStyle } from './PageStyle';
import { HostText, newId } from './parts';
import { SettingsFields } from './Settings';

export { parseWeekStart, toggleHidden } from './Settings';

export function SettingsView({
  settings,
  courses,
  origin,
  onChange,
  onChangeAddress,
}: SettingsProps) {
  const [addressId] = useState(() => newId('address'));
  return (
    <div class="wr" data-surface="page">
      <PageStyle />
      <main class="wr-page">
        <header class="wr-page-head">
          <AppMark size={32} />
          <h1 class="wr-page-title">{t('settingsTitle')}</h1>
        </header>
        <SettingsFields settings={settings} courses={courses} level={2} onChange={onChange} />
        <section class="wr-setting wr-setting-row wr-address" aria-labelledby={addressId}>
          <div>
            <h2 class="wr-setting-name" id={addressId}>
              {t('settingAddress')}
            </h2>
            {origin ? (
              <HostText class="wr-address-value" host={hostOf(origin)} />
            ) : (
              <p class="wr-setting-help">{t('addressNotSet')}</p>
            )}
          </div>
          <button type="button" class="wr-btn wr-btn-small" onClick={onChangeAddress}>
            {t('changeAddress')}
          </button>
        </section>
      </main>
    </div>
  );
}
