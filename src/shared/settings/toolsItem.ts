/**
 * The stored tools settings (design decisions 5 and 22). A trusted item (see
 * shared/platform/trustedStorage.ts): the storage lock on Chrome and Edge, the vault on Firefox,
 * and per-field normalization on every read. Only the background and the extension pages import
 * this file.
 */
import { createTrustedItem } from '../platform/trustedStorage';
import type { StorageItem } from '../platform/storageItem';
import { DEFAULT_TOOLS_SETTINGS, normalizeToolsSettings, type ToolsSettings } from './tools';

export const toolsSettingsItem: StorageItem<ToolsSettings> = /* @__PURE__ */ createTrustedItem({
  key: 'toolsSettings',
  fallback: () => structuredClone(DEFAULT_TOOLS_SETTINGS),
  normalize: normalizeToolsSettings,
});
