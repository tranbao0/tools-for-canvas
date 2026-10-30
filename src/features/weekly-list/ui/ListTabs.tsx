/**
 * The switch under the rings: "Tasks" and "Announcements" (design decision 24). It is the ARIA
 * tabs pattern, drawn like the tabs of Canvas: text tabs on a line, the chosen one marked by a
 * bar in the brand color. The arrow keys move between the tabs and choose the tab at once.
 */
import type { TargetedKeyboardEvent } from 'preact';
import { t } from '../../../shared/ui/i18n';
import type { ListTab } from '../data/announcements';

const TABS: readonly ListTab[] = ['tasks', 'announcements'];
const MAX_BADGE = 99;

export interface TabIds {
  tasks: string;
  announcements: string;
  panel: string;
}

/** The id of the tab button of a tab. */
export function tabId(ids: TabIds, tab: ListTab): string {
  return tab === 'tasks' ? ids.tasks : ids.announcements;
}

export function ListTabs(props: {
  tab: ListTab;
  /** The unread announcements, or `null` while they load. */
  unread: number | null;
  ids: TabIds;
  onSelect(tab: ListTab): void;
}) {
  const { tab, unread, ids } = props;

  const onKeyDown = (event: TargetedKeyboardEvent<HTMLElement>) => {
    const at = TABS.indexOf(tab);
    let next: ListTab | undefined;
    if (event.key === 'ArrowRight') next = TABS[(at + 1) % TABS.length];
    else if (event.key === 'ArrowLeft') next = TABS[(at + TABS.length - 1) % TABS.length];
    else if (event.key === 'Home') next = TABS[0];
    else if (event.key === 'End') next = TABS[TABS.length - 1];
    if (next === undefined) return;
    event.preventDefault();
    props.onSelect(next);
    // The tab list is not re-created, so its buttons keep their place: focus follows the choice.
    const root = event.currentTarget.getRootNode() as Document | ShadowRoot;
    root.getElementById(tabId(ids, next))?.focus();
  };

  const badge = unread !== null && unread > 0 ? Math.min(unread, MAX_BADGE) : null;
  return (
    <div class="wr-tabs" role="tablist" aria-label={t('listTabs')} onKeyDown={onKeyDown}>
      {TABS.map((id) => {
        const selected = id === tab;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            id={tabId(ids, id)}
            class="wr-tab"
            data-part={`tab-${id}`}
            aria-selected={selected}
            aria-controls={ids.panel}
            aria-label={
              id === 'announcements' && unread !== null && unread > 0
                ? t('tabAnnouncementsUnread', String(unread))
                : id === 'tasks'
                  ? t('tabTasks')
                  : t('tabAnnouncements')
            }
            tabIndex={selected ? 0 : -1}
            onClick={() => props.onSelect(id)}
          >
            <span class="wr-tab-label">
              {id === 'tasks' ? t('tabTasks') : t('tabAnnouncements')}
            </span>
            {id === 'announcements' && (
              <span class="wr-tab-compact" aria-hidden="true">
                {t('tabAnnouncementsCompact')}
              </span>
            )}
            {id === 'announcements' && badge !== null && (
              <span class="wr-tab-badge" aria-hidden="true">
                {unread !== null && unread > MAX_BADGE ? `${MAX_BADGE}+` : badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
