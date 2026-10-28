// Stops a test run on a Node version without the global Temporal API.
//
// The extension code uses Temporal, and so do the tests. The build runs on Node 24.14 and
// later, but the tests need Node 26 or later (see .nvmrc).

/**
 * Throws a clear error when the global Temporal API is missing.
 * @param {{ Temporal?: unknown }} [scope] the global scope to check
 * @param {string} [nodeVersion] the running Node version, for the message
 */
export function requireTemporal(scope = globalThis, nodeVersion = process.version) {
  if (typeof scope.Temporal !== 'undefined') return;
  // The error has no stack, because the message says it all and a test runner that maps the
  // stack to source lines can fail on this error and hide the message.
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 0;
  const error = new Error(
    `Tests need Node 26 or later for the global Temporal API, and this is Node ${nodeVersion}. ` +
      'Run nvm use, or see .nvmrc.',
  );
  Error.stackTraceLimit = limit;
  throw error;
}
