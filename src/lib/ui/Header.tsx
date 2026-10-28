/**
 * The week header, styled as a Canvas right-column section heading: the week range with the add
 * and settings buttons, then the week arrows, "This week" and the time zone label.
 */
import { t } from '../i18n';
import type { WeekView } from '../model/types';
import { formatWeekRange, formatWeekRangeLong, timeZoneLabel } from './format';
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from './icons';
import { GearButton, Heading, type HeadingLevel } from './parts';

export interface HeaderProps {
  /** `null` while loading: the header keeps its final layout, with the list title for the range. */
  view: WeekView | null;
  level: HeadingLevel;
  refreshing: boolean;
  /** Set when adding a task is not possible, with the reason. */
  addDisabledReason: string | null;
  addDescribedBy?: string;
  /** Moves from the week the student last asked for: -1 or 1. */
  onStep(delta: number): void;
  onThisWeek(): void;
  onAdd(): void;
  onSettings(): void;
}

export function Header(props: HeaderProps) {
  const { view } = props;
  const addDisabled = view === null || props.addDisabledReason !== null;
  const thisWeekOff = view === null || view.isCurrentWeek;
  const zoneInstant = view ? `${view.today}T12:00:00Z` : '';
  return (
    <header class="wr-header">
      <div class="wr-head">
        <Heading level={props.level} class="wr-range">
          {view ? (
            <>
              <span aria-hidden="true">{formatWeekRange(view.weekStart, view.weekEnd)}</span>
              <span class="wr-sr">{formatWeekRangeLong(view.weekStart, view.weekEnd)}</span>
            </>
          ) : (
            t('listTitle')
          )}
        </Heading>
        <button
          type="button"
          class="wr-icon-btn wr-add"
          aria-label={t('addTask')}
          aria-disabled={addDisabled}
          aria-describedby={props.addDisabledReason ? props.addDescribedBy : undefined}
          title={props.addDisabledReason ?? t('addTask')}
          onClick={() => {
            if (!addDisabled) props.onAdd();
          }}
        >
          <PlusIcon />
          <span class="wr-btn-label" aria-hidden="true">
            {t('addTask')}
          </span>
        </button>
        <GearButton onClick={props.onSettings} />
        {props.refreshing && (
          <div class="wr-progress" role="progressbar" aria-label={t('refreshing')} />
        )}
      </div>
      <div class="wr-nav-row">
        <div class="wr-nav" role="group" aria-label={t('weekNav')}>
          <button
            type="button"
            class="wr-icon-btn"
            aria-label={t('prevWeek')}
            title={t('prevWeek')}
            disabled={view === null}
            onClick={() => props.onStep(-1)}
          >
            <ChevronLeftIcon />
          </button>
          {/*
           * aria-disabled, not disabled: a disabled button drops focus, and this one turns off
           * while it has focus, when it brings the student back to the current week.
           */}
          <button
            type="button"
            class="wr-this-week"
            aria-disabled={thisWeekOff}
            onClick={() => {
              if (!thisWeekOff) props.onThisWeek();
            }}
          >
            {t('thisWeek')}
          </button>
          <button
            type="button"
            class="wr-icon-btn"
            aria-label={t('nextWeek')}
            title={t('nextWeek')}
            disabled={view === null}
            onClick={() => props.onStep(1)}
          >
            <ChevronRightIcon />
          </button>
        </div>
        {view?.browserTimeZoneDiffers && (
          <span class="wr-tz" title={t('timesInLong', view.timeZone)}>
            {t('timesIn', timeZoneLabel(view.timeZone, zoneInstant))}
          </span>
        )}
      </div>
    </header>
  );
}
