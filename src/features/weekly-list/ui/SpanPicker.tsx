/**
 * The control that picks the span the list shows (design decision 9, "The shown span"): a native
 * select with Day, Week, 2 weeks, Month and "Custom: N days", and for a custom span a number
 * field. The header and the settings both use it.
 *
 * The number field checks itself with the browser's own rules (a whole number from 2 to 90) and
 * shows the browser's own message. The span is saved when the student leaves the field or presses
 * Enter, not with each key, because each save loads the list again.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../../../shared/ui/i18n';
import {
  MAX_CUSTOM_DAYS,
  MIN_CUSTOM_DAYS,
  SPAN_KINDS,
  type Span,
  type SpanKind,
} from '../model/types';

/**
 * How long a kind picked with a key on the closed select must stay before it is saved. Chrome
 * fires a change on each arrow key of a closed select, and each save loads the list again, so a
 * student who passes through spans on the way saves only the one that stays. A pick from the open
 * list, with the mouse or with Enter, saves at once.
 */
export const KIND_SAVE_DELAY_MS = 400;

export function SpanPicker(props: {
  span: Span;
  onChange(span: Span): void;
  /** The id of the select, for a label outside this control. */
  selectId?: string;
  /** The name of the select when no visible label points at it. */
  selectLabel?: string;
  /** The select and the number field are off, such as while the list has not loaded. */
  disabled?: boolean;
  /** Tells whether a picked kind waits to be saved, so the header can show its refresh marker. */
  onPending?(pending: boolean): void;
}) {
  const { span, disabled } = props;
  // A timer fires long after the render that set it, so it reads the newest props.
  const latest = useRef(props);
  latest.current = props;
  /** The kind picked with a key that waits to be saved. The select shows it at once. */
  const [picked, setPicked] = useState<SpanKind | null>(null);
  const shown = picked ?? span.kind;
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** The last key pressed in the select was an arrow key, and no change has used it yet. */
  const arrow = useRef(false);
  const field = useRef<HTMLInputElement>(null);
  /** Ends the wait, and saves `next` when there is one. */
  const done = (next?: Span) => {
    clearTimeout(timer.current);
    setPicked(null);
    latest.current.onPending?.(false);
    if (next) latest.current.onChange(next);
  };
  const saveKind = (kind: SpanKind) => {
    const saved = latest.current.span;
    done(kind === saved.kind ? undefined : { kind, days: saved.days });
  };
  // A new length from elsewhere shows in the field, unless the student is typing in it. The field
  // is not controlled, so a redraw of the list never replaces what the student typed.
  useEffect(() => {
    const input = field.current;
    if (input && (input.getRootNode() as Document | ShadowRoot).activeElement !== input)
      input.value = String(span.days);
  }, [span.days]);
  const save = (input: HTMLInputElement) => {
    if (!input.checkValidity()) {
      // The kind that waits is saved with the length that the list holds.
      if (picked !== null) saveKind(picked);
      input.reportValidity();
      return;
    }
    const saved = latest.current.span;
    const days = input.valueAsNumber;
    done(days === saved.days && saved.kind === 'custom' ? undefined : { kind: 'custom', days });
  };
  return (
    <div class="wr-span">
      <select
        id={props.selectId}
        class="wr-input wr-span-select"
        aria-label={props.selectLabel}
        disabled={disabled}
        value={shown}
        onKeyDown={(event) => (arrow.current = event.key.startsWith('Arrow'))}
        onChange={(event) => {
          const kind = event.currentTarget.value as SpanKind;
          const keyed = arrow.current;
          arrow.current = false;
          if (!keyed) return saveKind(kind);
          clearTimeout(timer.current);
          setPicked(kind);
          latest.current.onPending?.(true);
          timer.current = setTimeout(() => saveKind(kind), KIND_SAVE_DELAY_MS);
        }}
        onBlur={() => picked !== null && saveKind(picked)}
      >
        {SPAN_KINDS.map((kind) => (
          <option key={kind} value={kind}>
            {t(`spanKind_${kind}`, String(span.days))}
          </option>
        ))}
      </select>
      {shown === 'custom' && (
        <label class="wr-span-days">
          {t('spanDaysLabel')}
          <input
            class="wr-input wr-span-input"
            type="number"
            required
            min={MIN_CUSTOM_DAYS}
            max={MAX_CUSTOM_DAYS}
            ref={field}
            defaultValue={span.days}
            disabled={disabled}
            onChange={(event) => save(event.currentTarget)}
            onKeyDown={(event) => event.key === 'Enter' && save(event.currentTarget)}
          />
        </label>
      )}
    </div>
  );
}
