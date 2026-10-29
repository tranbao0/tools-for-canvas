/**
 * The span header, styled as a Canvas right-column section heading: the range of the shown span
 * with the add and settings buttons, then the arrows, "Today", the span control and the time zone
 * label.
 */
import { t } from '../i18n';
import type { Span, WeekView } from '../model/types';
import { formatSpanRange, formatSpanRangeLong, spanUnit, timeZoneLabel } from './format';
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from './icons';
import { GearButton, Heading, type HeadingLevel } from './parts';
import { SpanPicker } from './SpanPicker';

export interface HeaderProps {
  /** `null` while loading: the header keeps its final layout, with the list title for the range. */
  view: WeekView | null;
  level: HeadingLevel;
  refreshing: boolean;
  /** Set when adding a task is not possible, with the reason. */
  addDisabledReason: string | null;
  addDescribedBy?: string;
  /** The span the student picked. The arrows and the control follow it, not the view on screen. */
  span: Span;
  /** Saves the span the student picks. `null` while the settings load: the control is off. */
  onSpan: ((span: Span) => void) | null;
  /** Moves from the span the student last asked for: -1 or 1. */
  onStep(delta: number): void;
  onToday(): void;
  onAdd(): void;
  onSettings(): void;
}

export function Header(props: HeaderProps) {
  const { view } = props;
  const addDisabled = view === null || props.addDisabledReason !== null;
  const todayOff = view === null || view.isCurrentSpan;
  const unit = spanUnit(props.span);
  const prev = t('prevSpan', unit);
  const next = t('nextSpan', unit);
  const zoneInstant = view ? `${view.today}T12:00:00Z` : '';
  return (
    <header class="wr-header">
      <div class="wr-head">
        <Heading level={props.level} class="wr-range">
          {view ? (
            <>
              <span aria-hidden="true">
                {formatSpanRange(view.span, view.spanStart, view.spanEnd)}
              </span>
              <span class="wr-sr">
                {formatSpanRangeLong(view.span, view.spanStart, view.spanEnd)}
              </span>
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
        <div class="wr-nav" role="group" aria-label={t('spanNav')}>
          <button
            type="button"
            class="wr-icon-btn"
            aria-label={prev}
            title={prev}
            disabled={view === null}
            onClick={() => props.onStep(-1)}
          >
            <ChevronLeftIcon />
          </button>
          {/*
           * aria-disabled, not disabled: a disabled button drops focus, and this one turns off
           * while it has focus, when it brings the student back to the span that holds today.
           */}
          <button
            type="button"
            class="wr-this-week"
            aria-disabled={todayOff}
            onClick={() => {
              if (!todayOff) props.onToday();
            }}
          >
            {t('goToToday')}
          </button>
          <button
            type="button"
            class="wr-icon-btn"
            aria-label={next}
            title={next}
            disabled={view === null}
            onClick={() => props.onStep(1)}
          >
            <ChevronRightIcon />
          </button>
        </div>
        <SpanPicker
          span={props.span}
          selectLabel={t('spanPicker')}
          disabled={props.onSpan === null}
          onChange={(span) => props.onSpan?.(span)}
        />
        {view?.browserTimeZoneDiffers && (
          <span class="wr-tz" title={t('timesInLong', view.timeZone)}>
            {t('timesIn', timeZoneLabel(view.timeZone, zoneInstant))}
          </span>
        )}
      </div>
    </header>
  );
}
