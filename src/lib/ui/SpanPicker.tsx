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
import { t } from '../i18n';
import {
  MAX_CUSTOM_DAYS,
  MIN_CUSTOM_DAYS,
  SPAN_KINDS,
  type Span,
  type SpanKind,
} from '../model/types';

/**
 * How long a picked kind must stay before it is saved. Chrome fires a change on each arrow key of
 * a closed select, and each save loads the list again, so a student who passes through spans on
 * the way saves only the one that stays.
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
}) {
  const { span, disabled } = props;
  /**
   * The kind the student picked and the settings do not hold yet, with the saved kind it was
   * picked from. The select shows it at once, until the saved kind changes.
   */
  const [picked, setPicked] = useState<{ kind: SpanKind; from: SpanKind } | null>(null);
  const shown = picked?.from === span.kind ? picked.kind : span.kind;
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const field = useRef<HTMLInputElement>(null);
  const saveKind = (kind: SpanKind) => {
    clearTimeout(timer.current);
    if (kind !== span.kind) props.onChange({ kind, days: span.days });
  };
  // A new length from elsewhere shows in the field, unless the student is typing in it. The field
  // is not controlled, so a redraw of the list never replaces what the student typed.
  useEffect(() => {
    const input = field.current;
    if (input && (input.getRootNode() as Document | ShadowRoot).activeElement !== input)
      input.value = String(span.days);
  }, [span.days]);
  const save = (input: HTMLInputElement) => {
    // A kind that waits to be saved is custom, and this save carries it.
    clearTimeout(timer.current);
    if (!input.checkValidity()) input.reportValidity();
    else if (input.valueAsNumber !== span.days || span.kind !== 'custom')
      props.onChange({ kind: 'custom', days: input.valueAsNumber });
  };
  return (
    <div class="wr-span">
      <select
        id={props.selectId}
        class="wr-input wr-span-select"
        aria-label={props.selectLabel}
        disabled={disabled}
        value={shown}
        onChange={(event) => {
          const kind = event.currentTarget.value as SpanKind;
          setPicked({ kind, from: span.kind });
          clearTimeout(timer.current);
          timer.current = setTimeout(() => saveKind(kind), KIND_SAVE_DELAY_MS);
        }}
        onBlur={() => saveKind(shown)}
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
