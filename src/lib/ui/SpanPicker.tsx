/**
 * The control that picks the span the list shows (design decision 9, "The shown span"): a native
 * select with Day, Week, 2 weeks, Month and "Custom: N days", and for a custom span a number
 * field. The header and the settings both use it.
 *
 * The number field checks itself with the browser's own rules (a whole number from 2 to 90) and
 * shows the browser's own message. The span is saved when the student leaves the field or presses
 * Enter, not with each key, because each save loads the list again.
 */
import { useEffect, useRef } from 'preact/hooks';
import { t } from '../i18n';
import {
  MAX_CUSTOM_DAYS,
  MIN_CUSTOM_DAYS,
  SPAN_KINDS,
  type Span,
  type SpanKind,
} from '../model/types';

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
  const field = useRef<HTMLInputElement>(null);
  // A new length from elsewhere shows in the field, unless the student is typing in it. The field
  // is not controlled, so a redraw of the list never replaces what the student typed.
  useEffect(() => {
    const input = field.current;
    if (input && (input.getRootNode() as Document | ShadowRoot).activeElement !== input)
      input.value = String(span.days);
  }, [span.days]);
  const save = (input: HTMLInputElement) => {
    if (!input.checkValidity()) input.reportValidity();
    else if (input.valueAsNumber !== span.days)
      props.onChange({ kind: 'custom', days: input.valueAsNumber });
  };
  return (
    <div class="wr-span">
      <select
        id={props.selectId}
        class="wr-input wr-span-select"
        aria-label={props.selectLabel}
        disabled={disabled}
        value={span.kind}
        onChange={(event) =>
          props.onChange({ kind: event.currentTarget.value as SpanKind, days: span.days })
        }
      >
        {SPAN_KINDS.map((kind) => (
          <option key={kind} value={kind}>
            {t(`spanKind_${kind}`, String(span.days))}
          </option>
        ))}
      </select>
      {span.kind === 'custom' && (
        <form
          class="wr-span-days"
          onSubmit={(event) => {
            event.preventDefault();
            save(event.currentTarget.elements[0] as HTMLInputElement);
          }}
        >
          <label>
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
            />
          </label>
        </form>
      )}
    </div>
  );
}
