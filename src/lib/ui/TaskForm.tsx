/** The custom task form: create, edit and delete (design decision 10). */
import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../i18n';
import type { ItemView, WeekView } from '../model/types';
import type { TaskInput } from './contract';
import { formatClock, zonedDate, zonedTime } from './format';
import { CloseIcon } from './icons';
import { Heading, newIds, type HeadingLevel } from './parts';

export type TaskFormMode = { kind: 'new' } | { kind: 'edit'; item: ItemView };

/** Stored when the time is empty (design decision 10). */
const NO_TIME = '23:59';

/** Today when today is in the viewed week, otherwise the first day of the viewed week. */
export function defaultTaskDate(view: WeekView): string {
  return view.today >= view.weekStart && view.today <= view.weekEnd ? view.today : view.weekStart;
}

interface Draft {
  title: string;
  date: string;
  time: string;
  courseId: string;
  details: string;
}

function initialDraft(mode: TaskFormMode, view: WeekView, courseIds: string[]): Draft {
  if (mode.kind === 'edit') {
    const { item } = mode;
    const time = item.due ? zonedTime(item.due, view.timeZone) : '';
    return {
      title: item.title,
      date: item.due ? zonedDate(item.due, view.timeZone) : defaultTaskDate(view),
      time: time === NO_TIME ? '' : time,
      courseId: item.courseId ?? '',
      details: item.noteDetails ?? '',
    };
  }
  const preferred =
    view.scopeCourseId ?? (typeof view.courseFilter === 'string' ? view.courseFilter : null);
  return {
    title: '',
    date: defaultTaskDate(view),
    time: '',
    courseId: preferred !== null && courseIds.includes(preferred) ? preferred : '',
    details: '',
  };
}

export function draftToInput(draft: Draft): TaskInput {
  const details = draft.details.trim();
  return {
    title: draft.title.trim(),
    date: draft.date,
    time: draft.time === '' ? null : draft.time,
    courseId: draft.courseId === '' ? null : draft.courseId,
    details: details === '' ? null : details,
  };
}

interface Errors {
  title: boolean;
  date: boolean;
}

function validate(draft: Draft): Errors {
  return { title: draft.title.trim() === '', date: !/^\d{4}-\d{2}-\d{2}$/.test(draft.date) };
}

export function TaskForm(props: {
  mode: TaskFormMode;
  view: WeekView;
  courses: { id: string; name: string }[];
  level: HeadingLevel;
  onSubmit(input: TaskInput): void;
  onDelete(noteId: string): void;
  onCancel(): void;
}) {
  const { mode, view } = props;
  const [ids] = useState(() =>
    newIds('form', [
      'heading',
      'title',
      'titleError',
      'date',
      'dateError',
      'time',
      'timeHint',
      'course',
      'details',
    ]),
  );
  const [draft, setDraft] = useState<Draft>(() =>
    initialDraft(
      mode,
      view,
      props.courses.map((c) => c.id),
    ),
  );
  const [errors, setErrors] = useState<Errors>({ title: false, date: false });
  const titleRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const update = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  const courseOptions = [...props.courses];
  if (
    mode.kind === 'edit' &&
    mode.item.courseId !== null &&
    !courseOptions.some((c) => c.id === mode.item.courseId)
  ) {
    courseOptions.push({ id: mode.item.courseId, name: mode.item.contextLabel });
  }

  const onSubmit = (event: Event) => {
    event.preventDefault();
    const found = validate(draft);
    setErrors(found);
    if (found.title) {
      titleRef.current?.focus();
      return;
    }
    if (found.date) {
      dateRef.current?.focus();
      return;
    }
    props.onSubmit(draftToInput(draft));
  };

  const noteId = mode.kind === 'edit' ? mode.item.noteId : null;

  return (
    <form
      class="wr-form"
      aria-labelledby={ids.heading}
      noValidate
      onSubmit={onSubmit}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          props.onCancel();
        }
      }}
    >
      <div class="wr-head">
        <Heading level={props.level} class="wr-range" id={ids.heading}>
          {mode.kind === 'new' ? t('taskNew') : t('taskEdit')}
        </Heading>
        <button
          type="button"
          class="wr-icon-btn"
          aria-label={t('close')}
          title={t('close')}
          onClick={props.onCancel}
        >
          <CloseIcon />
        </button>
      </div>

      <div class="wr-field">
        <label class="wr-label" for={ids.title}>
          {t('taskTitle')}
        </label>
        <input
          ref={titleRef}
          id={ids.title}
          class="wr-input"
          type="text"
          autocomplete="off"
          required
          aria-invalid={errors.title}
          aria-describedby={errors.title ? ids.titleError : undefined}
          value={draft.title}
          onInput={(event) => update({ title: event.currentTarget.value })}
        />
        {errors.title && (
          <p id={ids.titleError} class="wr-error">
            {t('taskTitleRequired')}
          </p>
        )}
      </div>

      <div class="wr-field-row">
        <div class="wr-field">
          <label class="wr-label" for={ids.date}>
            {t('taskDate')}
          </label>
          <input
            ref={dateRef}
            id={ids.date}
            class="wr-input"
            type="date"
            required
            aria-invalid={errors.date}
            aria-describedby={errors.date ? ids.dateError : undefined}
            value={draft.date}
            onInput={(event) => update({ date: event.currentTarget.value })}
          />
          {errors.date && (
            <p id={ids.dateError} class="wr-error">
              {t('taskDateRequired')}
            </p>
          )}
        </div>
        <div class="wr-field">
          <label class="wr-label" for={ids.time}>
            {t('taskTime')}
            <span class="wr-optional">{t('optional')}</span>
          </label>
          <input
            id={ids.time}
            class="wr-input"
            type="time"
            aria-describedby={ids.timeHint}
            value={draft.time}
            onInput={(event) => update({ time: event.currentTarget.value })}
          />
        </div>
      </div>
      <p id={ids.timeHint} class="wr-hint">
        {t('taskTimeHint', formatClock(23, 59, view.hourCycle))}
      </p>

      <div class="wr-field">
        <label class="wr-label" for={ids.course}>
          {t('taskCourse')}
          <span class="wr-optional">{t('optional')}</span>
        </label>
        <select
          id={ids.course}
          class="wr-input"
          value={draft.courseId}
          onChange={(event) => update({ courseId: event.currentTarget.value })}
        >
          <option value="">{t('taskCourseNone')}</option>
          {courseOptions.map((course) => (
            <option key={course.id} value={course.id}>
              {course.name}
            </option>
          ))}
        </select>
      </div>

      <div class="wr-field">
        <label class="wr-label" for={ids.details}>
          {t('taskDetails')}
          <span class="wr-optional">{t('optional')}</span>
        </label>
        <textarea
          id={ids.details}
          class="wr-input"
          rows={3}
          value={draft.details}
          onInput={(event) => update({ details: event.currentTarget.value })}
        />
      </div>

      <div class="wr-form-actions">
        {noteId !== null && (
          <button type="button" class="wr-link-btn" onClick={() => props.onDelete(noteId)}>
            {t('deleteTask')}
          </button>
        )}
        <div class="wr-form-main">
          <button type="button" class="wr-btn" onClick={props.onCancel}>
            {t('cancel')}
          </button>
          <button type="submit" class="wr-btn wr-btn-primary">
            {mode.kind === 'new' ? t('addTask') : t('save')}
          </button>
        </div>
      </div>
    </form>
  );
}
