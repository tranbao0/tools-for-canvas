import { ensureBuild } from '../../scripts/lib/ensure-build.mjs';
import { requireTemporal } from '../../scripts/lib/require-temporal.mjs';

/**
 * Checks the Node version, then builds the Chrome extension once before the tests, unless the
 * build is newer than the sources. The real side panel test uses a second build, made with
 * test-only code.
 */
export default function globalSetup(): void {
  requireTemporal();
  ensureBuild('chrome');
  ensureBuild('chrome', 'e2e');
}
