import { createBackgroundDataOwner, wireDataTriggers } from '@/lib/data/background';
import { wireDataRouter } from '@/lib/data/router';
import { wireActionClick } from '@/lib/platform/actionClick';
import { wireInstall } from '@/lib/platform/install';
import { logFailure } from '@/lib/platform/log';
import { wirePageSync } from '@/lib/platform/pageSync';
import { createPanelRegistry } from '@/lib/platform/panelRegistry';
import { restrictStorageToTrustedContexts } from '@/lib/platform/trustedStorage';

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
});
