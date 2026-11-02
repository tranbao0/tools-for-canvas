/**
 * The tabs of the open files (design decision 25). It is the ARIA tabs pattern, drawn like the
 * tabs of Canvas: text tabs on a line, the chosen one marked by a bar in the brand color.
 * Each tab holds a file type icon and the file name. A close button sits next to each tab, in a
 * presentational wrapper, because a button cannot sit inside another button.
 * The arrow keys, Home and End move between the tabs and activate the tab at once.
 */
import type { TargetedKeyboardEvent } from 'preact';
import { useEffect } from 'preact/hooks';
import { t } from '../../../shared/ui/i18n';
import { CloseIcon, FileIcon, type FileIconKind } from '../../../shared/ui/icons';
import type { Tabs } from '../model';
import { tabKeyTarget } from './tabKeys';

export const PANEL_ID = 'fv-panel';

/** The id of the tab button of a file. */
export function tabDomId(fileId: string): string {
  return `fv-tab-${fileId}`;
}

export interface TabItem {
  name: string;
  kind: FileIconKind;
}

export function TabStrip(props: {
  tabs: Tabs;
  /** What is known about each file. A file that is still loading has no entry. */
  items: Readonly<Record<string, TabItem | undefined>>;
  onActivate(fileId: string): void;
  onClose(fileId: string): void;
}) {
  const { ids, active } = props.tabs;

  useEffect(() => {
    if (active === null) return;
    // A tab that is out of view scrolls in; the strip scrolls sideways when the tabs overflow.
    document
      .getElementById(tabDomId(active))
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [active]);

  const onKeyDown = (event: TargetedKeyboardEvent<HTMLElement>) => {
    const tab = (event.target as HTMLElement).closest<HTMLElement>('[role="tab"]');
    const fileId = tab?.dataset['fileId'];
    if (!tab || fileId === undefined) return;
    const target = tabKeyTarget(event.key, ids.indexOf(fileId), ids.length);
    const next = target === null ? undefined : ids[target];
    if (next === undefined) return;
    event.preventDefault();
    props.onActivate(next);
    // The tabs stay in place, so focus follows the choice.
    document.getElementById(tabDomId(next))?.focus();
  };

  return (
    <div class="fv-tabs" role="tablist" aria-label={t('fileTabs')} onKeyDown={onKeyDown}>
      {ids.map((fileId) => {
        const selected = fileId === active;
        const item = props.items[fileId];
        const name = item?.name ?? t('fileTabLoading');
        return (
          <div key={fileId} class="fv-tab" role="presentation" data-selected={selected}>
            <button
              type="button"
              role="tab"
              id={tabDomId(fileId)}
              class="fv-tab-main"
              data-file-id={fileId}
              title={name}
              aria-selected={selected}
              aria-controls={PANEL_ID}
              tabIndex={selected ? 0 : -1}
              onClick={() => props.onActivate(fileId)}
            >
              <FileIcon kind={item?.kind ?? 'document'} />
              <span class="fv-tab-name">{name}</span>
            </button>
            <button
              type="button"
              class="wr-icon-btn fv-tab-close"
              aria-label={t('fileTabClose', name)}
              title={t('fileTabClose', name)}
              tabIndex={selected ? 0 : -1}
              onClick={() => props.onClose(fileId)}
            >
              <CloseIcon />
            </button>
          </div>
        );
      })}
    </div>
  );
}
