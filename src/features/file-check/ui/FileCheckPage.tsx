/** The page of the file access check (design decision 23). */
import { useState } from 'preact/hooks';
import { logFailure } from '../../../shared/platform/log';
import { newIds } from '../../../shared/ui/parts';
import { browserLabel } from '../environment';
import { buildReport } from '../report';
import { emptyResults, runFileCheck } from '../run';
import type { CheckResults, ReportEnvironment } from '../types';
import type { FileCheckMessage } from '../protocol';

export interface FileCheckPageProps {
  /** The saved Canvas origin, or `null` when none is saved. */
  origin: string | null;
  extensionVersion: string;
  userAgent: string;
  send(message: FileCheckMessage): Promise<unknown>;
  fetchImpl?: typeof fetch;
  copyText(text: string): Promise<void>;
  now?: () => Date;
}

type Phase = 'idle' | 'running' | 'done';

export function FileCheckPage(props: FileCheckPageProps) {
  const [ids] = useState(() => newIds('fc', ['file', 'report']));
  const [pasted, setPasted] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [report, setReport] = useState('');
  const [copied, setCopied] = useState(false);
  const { origin } = props;

  const environment = (): ReportEnvironment => ({
    browser: browserLabel(props.userAgent),
    extensionVersion: props.extensionVersion,
    canvasHost: origin === null ? 'none saved' : new URL(origin).host,
    date: (props.now?.() ?? new Date()).toISOString().slice(0, 10),
  });

  const run = (): void => {
    if (origin === null || phase === 'running') return;
    setPhase('running');
    setCopied(false);
    setReport(buildReport(emptyResults(), environment()));
    runFileCheck(pasted, {
      origin,
      send: props.send,
      fetchImpl: props.fetchImpl,
      onProgress: (results: CheckResults) => setReport(buildReport(results, environment())),
    })
      .then((results) => setReport(buildReport(results, environment())))
      .catch((error: unknown) => logFailure('file access check', error))
      .finally(() => setPhase('done'));
  };

  const copy = (): void => {
    props
      .copyText(report)
      .then(() => setCopied(true))
      .catch((error: unknown) => logFailure('copy report', error));
  };

  return (
    <div class="wr" data-surface="page">
      <main class="wr-page" data-part="file-check">
        <header class="wr-page-head">
          <h1 class="wr-page-title">File access check</h1>
        </header>
        <p class="wr-page-lead">
          Open a Canvas page that has a file link. Then click Run check here. The check reads the
          Canvas tab you used last and writes nothing to Canvas.
        </p>
        {origin === null ? (
          <p class="wr-setting-help">No Canvas is saved. Open your Canvas first.</p>
        ) : (
          <>
            <div class="wr-setting">
              <label class="wr-setting-name" for={ids['file']}>
                File id or file link (optional)
              </label>
              <input
                id={ids['file']}
                class="wr-input"
                type="text"
                autocomplete="off"
                spellcheck={false}
                value={pasted}
                onInput={(event) => setPasted(event.currentTarget.value)}
              />
              <p class="wr-setting-help">
                Without one, the check uses the first file it finds on the page.
              </p>
            </div>
            <div class="wr-setting">
              <button
                type="button"
                class="wr-btn wr-btn-primary"
                data-part="run-check"
                aria-disabled={phase === 'running'}
                onClick={run}
              >
                {phase === 'running' ? 'Running...' : 'Run check'}
              </button>{' '}
              <button
                type="button"
                class="wr-btn"
                data-part="copy-report"
                disabled={report === '' || phase === 'running'}
                onClick={copy}
              >
                {copied ? 'Copied' : 'Copy report'}
              </button>
            </div>
          </>
        )}
        {report !== '' && (
          <section class="wr-setting" aria-labelledby={ids['report']}>
            <h2 class="wr-setting-name" id={ids['report']}>
              Report
            </h2>
            <pre class="wr-input" data-part="report" tabIndex={0}>
              {report}
            </pre>
          </section>
        )}
      </main>
    </div>
  );
}
