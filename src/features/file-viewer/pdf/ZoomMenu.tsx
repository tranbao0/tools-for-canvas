/** The zoom menu: Fit width, Fit page and the fixed zoom values (design decision 25). */
import { Fragment, type TargetedKeyboardEvent } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../../../shared/ui/i18n';
import { ChevronDownIcon } from '../../../shared/ui/icons';
import { FIT_PAGE, FIT_WIDTH, ZOOM_PRESETS, percentText, type ZoomMode } from './zoom';

export function zoomLabel(mode: ZoomMode, scale: number): string {
  if (mode.kind === 'fit-width') return t('pdfFitWidth');
  if (mode.kind === 'fit-page') return t('pdfFitPage');
  return t('pdfPercent', String(percentText(scale)));
}

interface Entry {
  key: string;
  label: string;
  mode: ZoomMode;
  checked: boolean;
}

function entries(mode: ZoomMode, scale: number): Entry[] {
  const list: Entry[] = [
    {
      key: 'fit-width',
      label: t('pdfFitWidth'),
      mode: FIT_WIDTH,
      checked: mode.kind === 'fit-width',
    },
    { key: 'fit-page', label: t('pdfFitPage'), mode: FIT_PAGE, checked: mode.kind === 'fit-page' },
  ];
  for (const value of ZOOM_PRESETS) {
    list.push({
      key: `scale-${value}`,
      label: t('pdfPercent', String(percentText(value))),
      mode: { kind: 'scale', value },
      checked: mode.kind === 'scale' && Math.abs(scale - value) < 0.005,
    });
  }
  return list;
}

export function ZoomMenu(props: { mode: ZoomMode; scale: number; onChoose(mode: ZoomMode): void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = entries(props.mode, props.scale);

  useEffect(() => {
    if (!open) return;
    const items = root.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]');
    const checked = [...(items ?? [])].find((item) => item.getAttribute('aria-checked') === 'true');
    (checked ?? items?.[0])?.focus();
    const away = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [open]);

  const close = (focusButton: boolean) => {
    setOpen(false);
    if (focusButton) button.current?.focus();
  };

  const onKeyDown = (event: TargetedKeyboardEvent<HTMLElement>) => {
    const items = [
      ...(root.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []),
    ];
    const at = items.indexOf(document.activeElement as HTMLElement);
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        // The pane closes on Escape. In a menu, Escape closes the menu only.
        event.stopPropagation();
        close(true);
        break;
      case 'ArrowDown':
        event.preventDefault();
        items[(at + 1) % items.length]?.focus();
        break;
      case 'ArrowUp':
        event.preventDefault();
        items[(at - 1 + items.length) % items.length]?.focus();
        break;
      case 'Home':
        event.preventDefault();
        items[0]?.focus();
        break;
      case 'End':
        event.preventDefault();
        items[items.length - 1]?.focus();
        break;
      case 'Tab':
        setOpen(false);
        break;
      default:
        break;
    }
  };

  return (
    <div class="pv-menu-host" ref={root} onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        class="pv-btn pv-zoom-label"
        data-part="pdf-zoom-menu"
        aria-label={t('pdfZoomLevel')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span data-part="pdf-zoom-text">{zoomLabel(props.mode, props.scale)}</span>
        <ChevronDownIcon />
      </button>
      {open && (
        <div class="pv-menu" role="menu" aria-label={t('pdfZoomLevel')}>
          {list.map((entry, index) => (
            <Fragment key={entry.key}>
              {index === 2 && <div class="pv-menu-rule" role="separator" />}
              <button
                type="button"
                role="menuitemradio"
                aria-checked={entry.checked}
                class="pv-menu-item"
                tabIndex={-1}
                onClick={() => {
                  props.onChoose(entry.mode);
                  close(true);
                }}
              >
                {entry.label}
              </button>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
