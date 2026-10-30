/** The quiet support line at the bottom of the settings and the welcome page (docs/roadmap.md). */
import { t } from './i18n';

/** The owner's Ko-fi page. A plain link: opening it sends nothing from the extension. */
export const SUPPORT_URL = 'https://ko-fi.com/baowows';

export function SupportLine() {
  return (
    <p class="wr-support">
      {t('supportLead')}{' '}
      <a href={SUPPORT_URL} target="_blank" rel="noopener noreferrer">
        {t('supportLink')}
      </a>
    </p>
  );
}
