/**
 * The "Developer" group of the settings. Only builds of the test channel have it, so its text is
 * not in the message file of the store builds. It holds the link that opens the file access
 * check (design decision 23).
 */
import { useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { logFailure } from '../../../shared/platform/log';
import { Heading, newIds, type HeadingLevel } from '../../../shared/ui/parts';

function openCheck(): void {
  // The settings also show inside a page script, where only `runtime` is available.
  browser.runtime
    .sendMessage({ type: 'weekrow:file-check-open' })
    .catch((error: unknown) => logFailure('file access check', error));
}

export function DeveloperSection(props: { level: HeadingLevel }) {
  const [ids] = useState(() => newIds('dev', ['group']));
  return (
    <section class="wr-setting" aria-labelledby={ids['group']}>
      <Heading level={props.level} class="wr-setting-name" id={ids['group']}>
        Developer
      </Heading>
      <p class="wr-setting-help">These tools are in test builds only.</p>
      <button type="button" class="wr-link-btn" data-part="file-check-link" onClick={openCheck}>
        File access check
      </button>
    </section>
  );
}
