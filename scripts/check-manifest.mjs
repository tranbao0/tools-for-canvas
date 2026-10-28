#!/usr/bin/env node
// Checks each built manifest against design decisions 4, 5, 13, 14 and 15.
//
// Usage: node scripts/check-manifest.mjs [--out-dir <dir>] [target ...]
import { existsSync } from 'node:fs';
import path from 'node:path';
import { browserOf, readJson, runForTargets } from './lib/build-output.mjs';

export const REQUIRED_HOST = 'https://*.instructure.com/*';
export const OPTIONAL_HOST = 'https://*/*';
const BROAD_MATCHES = new Set([OPTIONAL_HOST, 'http://*/*', '*://*/*', '<all_urls>']);
const CHROMIUM_PERMISSIONS = ['storage', 'cookies', 'scripting', 'activeTab', 'sidePanel'];
const FIREFOX_PERMISSIONS = ['storage', 'cookies', 'scripting', 'activeTab'];
const GECKO_ID = /^(?:[^@\s]+@[^@\s]+|\{[0-9a-f-]{36}\})$/i;

/**
 * @typedef {'chrome' | 'edge' | 'firefox'} Browser
 * @typedef {Record<string, any>} Manifest A parsed manifest.json. Its shape is what this module checks, so it stays loose.
 * @typedef {(file: string) => boolean} FileExists Tells whether a path relative to the build exists.
 */

/**
 * Returns the permissions that decision 5 allows for a browser.
 * @param {Browser} browser
 * @returns {string[]}
 */
export function expectedPermissions(browser) {
  switch (browser) {
    case 'chrome':
    case 'edge':
      return [...CHROMIUM_PERMISSIONS];
    case 'firefox':
      return [...FIREFOX_PERMISSIONS];
    default:
      throw new Error(`Unknown browser ${String(browser)}`);
  }
}

/**
 * Tells whether a content script match pattern stays inside the required host permission.
 * @param {string} pattern
 * @returns {boolean}
 */
export function isInsideRequiredHost(pattern) {
  const match = /^https:\/\/([^/]+)\/.*$/.exec(pattern);
  if (match === null) return false;
  const host = match[1] ?? '';
  return host === '*.instructure.com' || /^(?:[a-z0-9-]+\.)+instructure\.com$/i.test(host);
}

/**
 * @param {unknown} actual
 * @param {readonly string[]} expected
 * @returns {boolean}
 */
function isExactList(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    new Set(actual).size === actual.length &&
    expected.every((item) => actual.includes(item))
  );
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isEmptyOrMissing(value) {
  return value === undefined || (Array.isArray(value) && value.length === 0);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function show(value) {
  return JSON.stringify(value) ?? 'nothing';
}

/**
 * Checks the rules that hold for every browser.
 * @param {Browser} browser
 * @param {Manifest} manifest
 * @param {FileExists} fileExists
 * @returns {string[]}
 */
function checkCommon(browser, manifest, fileExists) {
  const problems = [];
  if (manifest.manifest_version !== 3) {
    problems.push(`manifest_version is ${show(manifest.manifest_version)}, expected 3`);
  }
  if (!isExactList(manifest.host_permissions, [REQUIRED_HOST])) {
    problems.push(
      `host_permissions is ${show(manifest.host_permissions)}, expected ["${REQUIRED_HOST}"]`,
    );
  }
  if (!isExactList(manifest.optional_host_permissions, [OPTIONAL_HOST])) {
    problems.push(
      `optional_host_permissions is ${show(manifest.optional_host_permissions)}, expected ["${OPTIONAL_HOST}"]`,
    );
  }
  const permissions = expectedPermissions(browser);
  if (!isExactList(manifest.permissions, permissions)) {
    problems.push(
      `permissions is ${show(manifest.permissions)}, expected exactly ${show(permissions)}`,
    );
  }
  if (!isEmptyOrMissing(manifest.optional_permissions)) {
    problems.push(`optional_permissions is ${show(manifest.optional_permissions)}, expected none`);
  }
  if (typeof manifest.action !== 'object' || manifest.action === null) {
    problems.push('action is missing');
  } else if (manifest.action.default_popup !== undefined) {
    problems.push('action has a default_popup, but the toolbar button must have no popup');
  }
  problems.push(...checkContentScripts(manifest, fileExists));
  problems.push(...checkLocales(manifest, fileExists));
  return problems;
}

/**
 * @param {Manifest} manifest
 * @param {FileExists} fileExists
 * @returns {string[]}
 */
function checkContentScripts(manifest, fileExists) {
  const problems = [];
  const scripts = Array.isArray(manifest.content_scripts) ? manifest.content_scripts : [];
  for (const script of scripts) {
    for (const pattern of script.matches ?? []) {
      if (BROAD_MATCHES.has(pattern)) {
        problems.push(
          `a content script matches ${pattern}; only the runtime-registered script may reach other hosts`,
        );
      } else if (!isInsideRequiredHost(pattern)) {
        problems.push(`a content script matches ${pattern}, which is outside ${REQUIRED_HOST}`);
      }
    }
    for (const file of [...(script.js ?? []), ...(script.css ?? [])]) {
      if (!fileExists(file)) problems.push(`content script file ${file} is missing`);
    }
  }
  return problems;
}

/**
 * @param {Manifest} manifest
 * @param {FileExists} fileExists
 * @returns {string[]}
 */
function checkLocales(manifest, fileExists) {
  const usesMessages = /__MSG_\w+__/.test(JSON.stringify(manifest));
  if (manifest.default_locale === undefined) {
    return usesMessages ? ['the manifest uses __MSG_ strings but has no default_locale'] : [];
  }
  const messages = `_locales/${manifest.default_locale}/messages.json`;
  return fileExists(messages)
    ? []
    : [`default_locale is "${manifest.default_locale}", but ${messages} is missing`];
}

/**
 * @param {Manifest} manifest
 * @param {FileExists} fileExists
 * @returns {string[]}
 */
function checkChromium(manifest, fileExists) {
  const problems = [];
  if (manifest.minimum_chrome_version !== '144') {
    problems.push(
      `minimum_chrome_version is ${show(manifest.minimum_chrome_version)}, expected "144"`,
    );
  }
  const panel = manifest.side_panel?.default_path;
  if (typeof panel !== 'string' || panel === '') {
    problems.push('side_panel.default_path is missing');
  } else if (!fileExists(panel)) {
    problems.push(`side_panel.default_path ${panel} is missing from the build`);
  }
  if (manifest.sidebar_action !== undefined)
    problems.push('sidebar_action is set, but it is for Firefox only');
  const worker = manifest.background?.service_worker;
  if (typeof worker !== 'string' || !fileExists(worker)) {
    problems.push(`background.service_worker ${show(worker)} is missing from the build`);
  }
  return problems;
}

/**
 * @param {Manifest} manifest
 * @param {FileExists} fileExists
 * @returns {string[]}
 */
function checkFirefox(manifest, fileExists) {
  const problems = [];
  const gecko = manifest.browser_specific_settings?.gecko;
  if (typeof gecko?.id !== 'string' || !GECKO_ID.test(gecko.id)) {
    problems.push(
      `browser_specific_settings.gecko.id is ${show(gecko?.id)}, expected an add-on id`,
    );
  }
  if (gecko?.strict_min_version !== '140.0') {
    problems.push(
      `gecko.strict_min_version is ${show(gecko?.strict_min_version)}, expected "140.0"`,
    );
  }
  const collection = gecko?.data_collection_permissions;
  if (!isExactList(collection?.required, ['none'])) {
    problems.push(
      `gecko.data_collection_permissions.required is ${show(collection?.required)}, expected ["none"]`,
    );
  }
  if (!isEmptyOrMissing(collection?.optional)) {
    problems.push(
      `gecko.data_collection_permissions.optional is ${show(collection?.optional)}, expected none`,
    );
  }
  const sidebar = manifest.sidebar_action;
  if (typeof sidebar?.default_panel !== 'string' || !fileExists(sidebar.default_panel)) {
    problems.push(
      `sidebar_action.default_panel ${show(sidebar?.default_panel)} is missing from the build`,
    );
  }
  // The side panel is optional and never opens by itself (decision 4). Firefox opens a sidebar
  // at install when the key is missing, so it must be false.
  if (sidebar?.open_at_install !== false) {
    problems.push(
      `sidebar_action.open_at_install is ${show(sidebar?.open_at_install)}, expected false`,
    );
  }
  if (manifest.side_panel !== undefined)
    problems.push('side_panel is set, but it is for Chrome and Edge only');
  const scripts = manifest.background?.scripts;
  if (
    !Array.isArray(scripts) ||
    scripts.length === 0 ||
    !scripts.every((file) => fileExists(file))
  ) {
    problems.push(`background.scripts ${show(scripts)} is missing from the build`);
  }
  return problems;
}

/**
 * Checks one manifest for one browser.
 * @param {Browser} browser
 * @param {Manifest} manifest
 * @param {FileExists} fileExists
 * @returns {string[]} the problems found
 */
export function checkManifest(browser, manifest, fileExists) {
  const problems = checkCommon(browser, manifest, fileExists);
  switch (browser) {
    case 'chrome':
    case 'edge':
      return [...problems, ...checkChromium(manifest, fileExists)];
    case 'firefox':
      return [...problems, ...checkFirefox(manifest, fileExists)];
    default:
      throw new Error(`Unknown browser ${String(browser)}`);
  }
}

if (import.meta.main) {
  await runForTargets('Manifest check', async (dir, target) => {
    const manifest = /** @type {Manifest} */ (await readJson(path.join(dir, 'manifest.json')));
    const problems = checkManifest(browserOf(target), manifest, (file) =>
      existsSync(path.join(dir, file.replace(/^\//, ''))),
    );
    if (problems.length === 0) console.log(`  ok   ${target}`);
    return problems;
  });
}
