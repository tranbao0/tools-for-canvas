/** The course progress rings (design decision 8). A click filters the list; a second click clears it. */
import { t } from '../i18n';
import type { Ring, WeekView } from '../model/types';
import { CheckIcon } from './icons';

const RADIUS = 17.5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** The full ring name: the course name, or the "Personal" text for the Personal ring. */
export function ringName(ring: Ring): string {
  return ring.courseId === null ? t('personal') : ring.label;
}

/**
 * The text under a ring, clamped to two lines: the course code, such as "CHEM 210", or the full
 * name of a course with no code.
 */
export function ringShortLabel(ring: Ring): string {
  return ring.courseId === null ? t('personal') : ring.shortLabel;
}

/**
 * The course part of the ring's accessible name. It starts with the visible label under the ring
 * (WCAG 2.5.3, Label in Name): the full name when it starts with that label, otherwise
 * "BIOL-201-F26, Cell Biology".
 */
export function ringSpokenName(ring: Ring): string {
  const name = ringName(ring);
  const visible = ringShortLabel(ring).trim();
  if (visible === '' || name.trim().toLowerCase().startsWith(visible.toLowerCase())) return name;
  return t('ringCourseName', visible, name);
}

/** "BIO 101 Cell Biology: 3 of 5 done this week, 1 past due" */
export function ringAriaLabel(ring: Ring): string {
  const name = ringSpokenName(ring);
  const done = String(ring.done);
  const total = String(ring.total);
  return ring.pastDue > 0
    ? t('ringLabelPastDue', name, done, total, String(ring.pastDue))
    : t('ringLabel', name, done, total);
}

/** A check mark shows only at 100 percent with nothing past due. */
export function ringIsComplete(ring: Ring): boolean {
  return ring.total > 0 && ring.done >= ring.total && ring.pastDue === 0;
}

export function isRingSelected(ring: Ring, filter: WeekView['courseFilter']): boolean {
  return filter !== undefined && filter === ring.courseId;
}

function RingGraphic({ ring }: { ring: Ring }) {
  const fraction = ring.total > 0 ? Math.min(ring.done / ring.total, 1) : 0;
  const centerText = `${ring.done}/${ring.total}`;
  return (
    <span class="wr-ring-graphic" aria-hidden="true">
      <svg viewBox="0 0 40 40">
        <circle class="wr-ring-track" cx="20" cy="20" r={RADIUS} fill="none" stroke-width="4" />
        {fraction > 0 && (
          <circle
            class="wr-ring-arc"
            cx="20"
            cy="20"
            r={RADIUS}
            fill="none"
            stroke-width="4"
            stroke-linecap="round"
            stroke-dasharray={CIRCUMFERENCE}
            stroke-dashoffset={CIRCUMFERENCE * (1 - fraction)}
          />
        )}
      </svg>
      {ringIsComplete(ring) ? (
        <span class="wr-ring-center">
          <CheckIcon />
        </span>
      ) : (
        <span class={centerText.length >= 5 ? 'wr-ring-center is-long' : 'wr-ring-center'}>
          {centerText}
        </span>
      )}
      {ring.pastDue > 0 && <span class="wr-ring-badge">{ring.pastDue}</span>}
    </span>
  );
}

function RingLabel({ ring }: { ring: Ring }) {
  return <span class="wr-ring-label">{ringShortLabel(ring)}</span>;
}

export function Rings(props: {
  rings: Ring[];
  filter: WeekView['courseFilter'];
  onSelect(courseId: string | null | undefined): void;
}) {
  if (props.rings.length === 0) return null;
  return (
    <section class="wr-rings-wrap" aria-label={t('ringsLabel')}>
      <ul class="wr-rings">
        {props.rings.map((ring) => {
          const selected = isRingSelected(ring, props.filter);
          return (
            <li key={ring.courseId ?? 'personal'}>
              <button
                type="button"
                class="wr-ring"
                style={{ '--wr-course': ring.color }}
                aria-pressed={selected}
                aria-label={ringAriaLabel(ring)}
                title={ringName(ring)}
                onClick={() => props.onSelect(selected ? undefined : ring.courseId)}
              >
                <RingGraphic ring={ring} />
                <RingLabel ring={ring} />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
