#!/usr/bin/env node
// Checks each built manifest against design decisions 4, 5, 13, 14 and 15.
//
// Usage: node scripts/check-manifest.mjs [--out-dir <dir>] [target ...]
import { existsSync } from 'node:fs';
import path from 'node:path';
import { browserOf, readJson, runForTargets } from './lib/build-output.mjs';

/** The one host permission, and the only match of the detector (decision 5). */
export const ALL_HTTPS = 'https://*/*';
/** The detector, the only static content script. */
export const DETECTOR_SCRIPT = 'detector.js';
/** The in-page list script. The background injects it, so the manifest must not list it. */
export const INPAGE_SCRIPT = 'inpage.js';
/** The script of the dashboard fixes. The background injects it into a dashboard page only. */
export const DASHBOARD_SCRIPT = 'dashboard.js';
const CHROMIUM_PERMISSIONS = ['storage', 'cookies', 'scripting', 'sidePanel'];
const FIREFOX_PERMISSIONS = ['storage', 'cookies', 'scripting'];
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
  if (!isExactList(manifest.host_permissions, [ALL_HTTPS])) {
    problems.push(
      `host_permissions is ${show(manifest.host_permissions)}, expected ["${ALL_HTTPS}"]`,
    );
  }
  if (!isEmptyOrMissing(manifest.optional_host_permissions)) {
    problems.push(
      `optional_host_permissions is ${show(manifest.optional_host_permissions)}, expected none`,
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
  for (const field of ['web_accessible_resources', 'externally_connectable']) {
    if (manifest[field] !== undefined) {
      problems.push(`${field} is set, but no page may reach the extension (decision 20)`);
    }
  }
  problems.push(...checkContentScripts(manifest, fileExists));
  problems.push(...checkLocales(manifest, fileExists));
  return problems;
}

/**
 * The only static content script is the detector: it matches every https page in the top frame,
 * and nothing else. The in-page list script is injected, so the manifest must not list it.
 * @param {Manifest} manifest
 * @param {FileExists} fileExists
 * @returns {string[]}
 */
function checkContentScripts(manifest, fileExists) {
  const problems = [];
  const scripts = Array.isArray(manifest.content_scripts) ? manifest.content_scripts : [];
  if (scripts.length !== 1) {
    problems.push(`content_scripts has ${scripts.length} entries, expected only the detector`);
  }
  for (const script of scripts) {
    if (!isExactList(script.matches, [ALL_HTTPS])) {
      problems.push(`a content script matches ${show(script.matches)}, expected ["${ALL_HTTPS}"]`);
    }
    if (!isExactList(script.js, [DETECTOR_SCRIPT])) {
      problems.push(`a content script runs ${show(script.js)}, expected ["${DETECTOR_SCRIPT}"]`);
    }
    if (script.all_frames === true) {
      problems.push('the detector must run in the top frame of a page only');
    }
    for (const field of ['match_origin_as_fallback', 'match_about_blank', 'world', 'css']) {
      if (script[field] !== undefined && !(field === 'css' && isEmptyOrMissing(script.css))) {
        problems.push(`the detector has ${field}, which the manifest must not set`);
      }
    }
    if (script.run_at !== 'document_idle') {
      problems.push(`the detector run_at is ${show(script.run_at)}, expected "document_idle"`);
    }
    for (const file of [...(script.js ?? []), ...(script.css ?? [])]) {
      if (!fileExists(file)) problems.push(`content script file ${file} is missing`);
    }
  }
  for (const script of [INPAGE_SCRIPT, DASHBOARD_SCRIPT]) {
    if (!fileExists(script)) {
      problems.push(`${script} is missing from the build, but the background injects it`);
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
