/**
 * The Full view button in the tab row of the file pane. The pane fills the browser page while it
 * is on. It is one element for as long as the pane shows it, so the focus stays on it after a toggle.
 */
import { useEffect, useState } from 'preact/hooks';
import { EXIT_FULL_VIEW_PATH, FULL_VIEW_PATH } from '../../../shared/ui/iconPaths';
import { t } from '../../../shared/ui/i18n';
import type { FullViewHost } from './fullView';

export function FullViewButton(props: { host: FullViewHost }) {
  const { host } = props;
  const [state, setState] = useState(host.get());
  useEffect(() => {
    setState(host.get());
    return host.subscribe(setState);
  }, [host]);
  if (!state.available) return null;
  const label = t(state.on ? 'exitFullView' : 'fullView');
  return (
    <button
      type="button"
      class="wr-btn wr-btn-small fv-full"
      data-part="full-view"
      aria-pressed={state.on}
      aria-label={label}
      onClick={() => host.set(!state.on)}
    >
      <svg
        class="wr-icon"
        width="1em"
        height="1em"
        viewBox="0 0 120 120"
        fill="currentColor"
        fill-rule="evenodd"
        aria-hidden="true"
        focusable="false"
      >
        <path d={state.on ? EXIT_FULL_VIEW_PATH : FULL_VIEW_PATH} />
      </svg>
      {label}
    </button>
  );
}
