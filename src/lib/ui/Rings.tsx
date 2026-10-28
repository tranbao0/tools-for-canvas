/**
 * The week's progress chart (design decision 8): concentric rings, one per class, over a legend.
 * A click on a ring or a legend row filters the list; a second click clears it.
 */
import { t } from '../i18n';
import type { Ring, WeekView } from '../model/types';
import { CheckIcon } from './icons';

/** The chart draws at most this many classes. The legend lists all of them. */
const MAX_RINGS = 6;
/** Chart units: the outer edge, the hole for the center text, and the gap between two rings. */
const OUTER = 58;
const HOLE = 30;
const GAP = 1.5;

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

/** "BIO 101, Cell Biology: 3 of 5 done this week, 1 past due" */
export function ringAriaLabel(ring: Ring): string {
  const name = ringSpokenName(ring);
  const done = String(ring.done);
  const total = String(ring.total);
  return ring.pastDue > 0
    ? t('ringLabelPastDue', name, done, total, String(ring.pastDue))
    : t('ringLabel', name, done, total);
}

export function isRingSelected(ring: Ring, filter: WeekView['courseFilter']): boolean {
  return filter !== undefined && filter === ring.courseId;
}

/** The classes the chart draws: the ones with the most work this week, in dashboard order. */
function chartRings(rings: Ring[]): Ring[] {
  if (rings.length <= MAX_RINGS) return rings;
  const keep = new Set([...rings].sort((a, b) => b.total - a.total).slice(0, MAX_RINGS));
  return rings.filter((ring) => keep.has(ring));
}

export function Rings(props: {
  rings: Ring[];
  filter: WeekView['courseFilter'];
  onSelect(courseId: string | null | undefined): void;
}) {
  const { rings, filter } = props;
  if (rings.length === 0) return null;
  const drawn = chartRings(rings);
  let [done, total, pastDue] = [0, 0, 0];
  for (const ring of rings) {
    done += ring.done;
    total += ring.total;
    pastDue += ring.pastDue;
  }
  const finished = total > 0 && done >= total && pastDue === 0;
  // 1 to 99 until every item is done, so a nearly empty or nearly full week never reads 0 or 100.
  const percent =
    total &&
    Math.min(done >= total ? 100 : 99, Math.max(done && 1, Math.round((done * 100) / total)));
  const width = Math.min(10, (OUTER - HOLE - GAP * (drawn.length - 1)) / drawn.length);
  const select = (ring: Ring) =>
    props.onSelect(isRingSelected(ring, filter) ? undefined : ring.courseId);
  return (
    <section class="wr-rings" aria-label={t('ringsLabel')}>
      <div class="wr-chart">
        <svg viewBox="0 0 120 120" aria-hidden="true" fill="none" stroke-width={width}>
          {drawn.map((ring, i) => {
            const radius = OUTER - width / 2 - i * (width + GAP);
            const fraction = ring.total > 0 ? Math.min(ring.done / ring.total, 1) : 0;
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
          <span>{`${done}/${total}`}</span>
        </div>
        <span class="wr-sr">
          {finished
            ? t('weekComplete', String(total))
            : t('weekProgress', String(done), String(total), String(percent))}
        </span>
      </div>
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
                aria-label={ringAriaLabel(ring)}
                title={ringName(ring)}
                onClick={() => select(ring)}
              >
                <i />
                <span class="wr-legend-code">{ringShortLabel(ring)}</span>
                <span>{`${ring.done}/${ring.total}`}</span>
                {ring.pastDue > 0 && <em title={t('groupPastDue')}>{ring.pastDue}</em>}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
