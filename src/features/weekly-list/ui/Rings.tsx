/**
 * The progress chart of the shown span (design decision 8): concentric rings, one per class, over a legend.
 * A click on a ring or a legend row filters the list; a second click clears it.
 */
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { t, tp } from '../../../shared/ui/i18n';
import type { Ring, Span, WeekView } from '../model/types';
import { spanPhrase } from './format';
import { CheckIcon } from '../../../shared/ui/icons';

/** The width where the legend moves beside the chart (the container query in styles.css). */
const WIDE_FROM = 280;
/** Chart units: the outer edge, the hole for the center text, and the gap between two rings. */
const OUTER = 58;
const HOLE = 22;
const GAP = 1;

/** "Nothing due in these 7 days", in the chart place of the rings or in the list. */
export function NothingDue(props: { span: Span }) {
  return (
    <p class="wr-empty">
      <CheckIcon />
      {t('nothingDue', spanPhrase(props.span))}
    </p>
  );
}

/** The full ring name: the course name, or the "Personal" text for the Personal ring. */
export function ringName(ring: Ring): string {
  return ring.courseId === null ? t('personal') : ring.label;
}

/** The legend text: the course code, such as "CHEM 210", or the full name of a course with no code. */
export function ringShortLabel(ring: Ring): string {
  return ring.courseId === null ? t('personal') : ring.shortLabel;
}

/**
 * The course part of the ring's accessible name. It starts with the visible legend text
 * (WCAG 2.5.3, Label in Name): the full name when it starts with that label, otherwise
 * "BIOL-201-F26, Cell Biology".
 */
export function ringSpokenName(ring: Ring): string {
  const name = ringName(ring);
  const visible = ringShortLabel(ring).trim();
  if (visible === '' || name.trim().toLowerCase().startsWith(visible.toLowerCase())) return name;
  return t('ringCourseName', visible, name);
}

/** "BIO 101, Cell Biology: 3 of 5 done in these 7 days, 1 past due" */
export function ringAriaLabel(ring: Ring, phrase: string): string {
  const name = ringSpokenName(ring);
  const done = String(ring.done);
  const total = String(ring.total);
  return ring.pastDue > 0
    ? t('ringLabelPastDue', name, done, total, String(ring.pastDue), phrase)
    : t('ringLabel', name, done, total, phrase);
}

export function isRingSelected(ring: Ring, filter: WeekView['courseFilter']): boolean {
  return filter !== undefined && filter === ring.courseId;
}

export function Rings(props: {
  rings: Ring[];
  /** The span the rings count, from the view. */
  span: Span;
  filter: WeekView['courseFilter'];
  /** Some days, or Past due, still load: the rings show what has arrived and keep growing. */
  loading?: boolean;
  onSelect(courseId: string | null | undefined): void;
}) {
  const { rings, filter, span, loading = false } = props;
  const phrase = spanPhrase(span);
  const ref = useRef<HTMLElement>(null);
  const [wide, setWide] = useState(false);
  // The legend sits beside the chart from WIDE_FROM on, and the chart then draws more classes.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    // The observer reports the width once when it starts, before the first paint.
    const observer = new ResizeObserver(() => setWide(element.clientWidth >= WIDE_FROM));
    observer.observe(element);
    return () => observer.disconnect();
  }, [rings.length > 0]);
  if (rings.length === 0) return null;
  // The classes with the most work in the span, in dashboard order. A class with no work stays in
  // the legend only.
  const worked = rings.filter((ring) => ring.total > 0);
  const top = new Set([...worked].sort((a, b) => b.total - a.total).slice(0, wide ? 6 : 4));
  const drawn = worked.filter((ring) => top.has(ring));
  const more = worked.length - drawn.length;
  let [done, total, pastDue] = [0, 0, 0];
  for (const ring of rings) {
    done += ring.done;
    total += ring.total;
    pastDue += ring.pastDue;
  }
  // The span is not finished while days or Past due still load, whatever has arrived.
  const finished = !loading && done >= total && pastDue === 0;
  // 1 to 99 until every item is done, so a nearly empty or nearly full span never reads 0 or 100.
  const percent = Math.min(
    done >= total ? 100 : 99,
    Math.max(done && 1, Math.round((done * 100) / total)),
  );
  // The stroke stays thick as the count grows: the hole shrinks instead of the rings thinning.
  const width = Math.min(10, (OUTER - HOLE - GAP * (drawn.length - 1)) / drawn.length);
  const select = (ring: Ring) =>
    props.onSelect(isRingSelected(ring, filter) ? undefined : ring.courseId);
  return (
    <section ref={ref} class="wr-rings" aria-label={t('ringsLabel')}>
      {drawn.length === 0 && loading ? (
        <div class="wr-chart wr-chart-loading" aria-hidden="true">
          <svg viewBox="0 0 120 120" fill="none" stroke-width={10}>
            <circle class="wr-ring-track" cx="60" cy="60" r={OUTER - 5} />
          </svg>
        </div>
      ) : drawn.length === 0 ? (
        <NothingDue span={span} />
      ) : (
        <div class="wr-chart">
          <svg viewBox="0 0 120 120" aria-hidden="true" fill="none" stroke-width={width}>
            {drawn.map((ring, i) => {
              const radius = OUTER - width / 2 - i * (width + GAP);
              const fraction = ring.done / ring.total;
              return (
                <g
                  key={ring.courseId ?? 'personal'}
                  class="wr-ring"
                  aria-pressed={isRingSelected(ring, filter)}
                  style={{ '--wr-course': ring.color }}
                  onClick={() => select(ring)}
                >
                  <circle class="wr-ring-track" cx="60" cy="60" r={radius} />
                  <circle
                    class="wr-ring-arc"
                    cx="60"
                    cy="60"
                    r={radius}
                    pathLength="1"
                    stroke-linecap="round"
                    stroke-dasharray="1 2"
                    stroke-dashoffset={1 - fraction}
                  />
                </g>
              );
            })}
          </svg>
          <div class="wr-chart-center" aria-hidden="true">
            {finished ? <CheckIcon /> : <b>{percent}%</b>}
            {/* With 3 or more rings the hole is too small for "All done", so the count stays. */}
            <span>{finished && drawn.length < 3 ? t('allDone') : `${done}/${total}`}</span>
          </div>
          {more > 0 && (
            <span class="wr-chart-more" aria-hidden="true">
              {`+${more}`}
            </span>
          )}
          <span class="wr-sr">
            {finished
              ? t('spanComplete', String(total), phrase)
              : t('spanProgress', String(done), String(total), String(percent), phrase)}
          </span>
        </div>
      )}
      <ul class="wr-legend">
        {rings.map((ring) => {
          const selected = isRingSelected(ring, filter);
          return (
            <li key={ring.courseId ?? 'personal'}>
              <button
                type="button"
                class="wr-legend-row"
                style={{ '--wr-course': ring.color }}
                aria-pressed={selected}
                aria-label={ringAriaLabel(ring, phrase)}
                title={ringName(ring)}
                onClick={() => select(ring)}
              >
                <i />
                <span class="wr-legend-code">{ringShortLabel(ring)}</span>
                {ring.pastDue > 0 && <em>{tp('lateBadge', ring.pastDue)}</em>}
                {ring.total > 0 && <span>{`${ring.done}/${ring.total}`}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
