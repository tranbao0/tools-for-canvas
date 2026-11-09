import { ensureBuild } from '../../scripts/lib/ensure-build.mjs';
import { requireTemporal } from '../../scripts/lib/require-temporal.mjs';

/**
 * Checks the Node version, then builds the Chrome extension once before the tests, unless the
 * build is newer than the sources. Pane tests and the real side panel test opt in to a second
 * build with test-only code. All other tests use the store build.
 */
export default function globalSetup(): void {
  requireTemporal();
  ensureBuild('chrome');
  ensureBuild('chrome', 'e2e');
}
