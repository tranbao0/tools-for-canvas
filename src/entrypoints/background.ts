import {
  createBackgroundDataOwner,
  wireDataTriggers,
} from '@/features/weekly-list/data/background';
import { wireDataRouter } from '@/features/weekly-list/data/router';
import { wireActionClick } from '@/shared/platform/actionClick';
import { wireInstall } from '@/shared/platform/install';
import { logFailure } from '@/shared/platform/log';
import { wireFileCheck } from '@/features/file-check/background';
import { wirePageSync } from '@/features/weekly-list/data/pageSync';
import { createPanelRegistry } from '@/shared/platform/panelRegistry';
import { restrictStorageToTrustedContexts } from '@/shared/platform/trustedStorage';

/**
 * Every listener is added synchronously at the top level, so the browser can wake the service
 * worker for any of these events. See docs/design.md, decisions 4, 5 and 11.
 */
export default defineBackground(() => {
  // First, so no page process can write the extension's storage while the worker runs.
  restrictStorageToTrustedContexts().catch((error: unknown) =>
    logFailure('storage access level', error),
  );
  const registry = createPanelRegistry();
  wireActionClick({ registry });
  wireInstall();
  const owner = createBackgroundDataOwner();
  wireDataRouter(owner);
  wireDataTriggers(owner);
  wirePageSync();
  // Only builds of the test channel include the file access check (docs/design.md, decision 23).
  if (__FILE_CHECK__) wireFileCheck();
});
