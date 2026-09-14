import { PREVIEW37_EXTENSION_QUERY } from './constants.mjs';

function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

function canonicalPreviewName(found) {
  const name = String(found?.name || '');
  const normalized = name.toLocaleLowerCase();
  const expected = PREVIEW37_EXTENSION_QUERY.toLocaleLowerCase();
  if (normalized === expected || normalized === `third-party/${expected}`) return name;
  return null;
}

export class SillyTavernExtensionControl {
  #findExtension;
  #disableExtension;
  #enableExtension;
  #extensionSettings;

  constructor({ findExtension, disableExtension, enableExtension, extensionSettings }) {
    this.#findExtension = requireFunction(findExtension, 'findExtension');
    this.#disableExtension = requireFunction(disableExtension, 'disableExtension');
    this.#enableExtension = requireFunction(enableExtension, 'enableExtension');
    if (!extensionSettings || !Array.isArray(extensionSettings.disabledExtensions)) {
      throw new TypeError('Official SillyTavern extension_settings.disabledExtensions is required');
    }
    this.#extensionSettings = extensionSettings;
  }

  findPreview37() {
    const found = this.#findExtension(PREVIEW37_EXTENSION_QUERY);
    const name = canonicalPreviewName(found);
    if (!name) return null;
    return Object.freeze({ name, enabled: found.enabled === true });
  }

  isPreview37Disabled() {
    const found = this.findPreview37();
    if (!found) return false;
    const persistedDisabled = this.#extensionSettings.disabledExtensions.includes(found.name);
    return persistedDisabled && found.enabled === false;
  }

  async disablePreview37AndReload() {
    const found = this.findPreview37();
    if (!found) throw new Error('Preview 37 extension cannot be resolved through the official SillyTavern extension API');
    if (!found.enabled || this.isPreview37Disabled()) {
      throw new Error('Preview 37 is not in the enabled pre-switch state required for the clean-reload boundary');
    }
    await this.#disableExtension(found.name, true);
    if (!this.isPreview37Disabled()) {
      throw new Error('Official SillyTavern disableExtension did not persist Preview 37 as disabled');
    }
    return Object.freeze({ changed: true, reloadRequested: true, previewName: found.name });
  }

  async enablePreview37AndReload() {
    const found = this.findPreview37();
    if (!found) throw new Error('Preview 37 extension cannot be resolved through the official SillyTavern extension API');
    if (found.enabled && !this.#extensionSettings.disabledExtensions.includes(found.name)) {
      return Object.freeze({ changed: false, reloadRequested: false, previewName: found.name });
    }
    await this.#enableExtension(found.name, true);
    const after = this.findPreview37();
    const persistedDisabled = after ? this.#extensionSettings.disabledExtensions.includes(after.name) : true;
    if (!after?.enabled || persistedDisabled) {
      throw new Error('Official SillyTavern enableExtension did not restore Preview 37 as enabled');
    }
    return Object.freeze({ changed: true, reloadRequested: true, previewName: after.name });
  }

  verifyPreview37Excluded({ launcherAbsent = false, rootAbsent = false, runtimeGlobalAbsent = false } = {}) {
    const found = this.findPreview37();
    const installed = Boolean(found);
    const persistedDisabled = installed ? this.isPreview37Disabled() : false;
    const checks = Object.freeze({
      previewRuntimeExcluded: installed ? persistedDisabled : true,
      launcherAbsent: launcherAbsent === true,
      rootAbsent: rootAbsent === true,
      runtimeGlobalAbsent: runtimeGlobalAbsent === true,
    });
    const blockers = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
    return Object.freeze({
      excluded: blockers.length === 0,
      blockers: Object.freeze(blockers),
      previewInstalled: installed,
      previewAbsent: !installed,
      previewPersistedDisabled: persistedDisabled,
      checks,
    });
  }
}
