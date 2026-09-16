import test from 'node:test';
import assert from 'node:assert/strict';
import { setupPhase9 } from '../phase9/call-fixtures.mjs';
import { BetaSettingsService, GLOBAL_IMAGE_SETTINGS_KEY } from '../../ui/settings-beta.mjs';
import { PixabayImageProvider } from '../../platform/image-providers/pixabay.mjs';
import { FakeDocument } from '../phase7/fake-dom.mjs';
import { renderImageProviderSettings, renderVoiceProviderHeading } from '../../ui/provider-settings.mjs';

test('Image API key is global across chats, stays out of scoped preferences, and reconfigures Pixabay live', async () => {
  const c = await setupPhase9({ castSize: 1, manifestId: 'provider-settings-global' }); const values = new Map(); const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const settings = new BetaSettingsService({ database: c.database, globalStorage: storage }); await settings.setImageApiKey({ scope: c.scope, playerInstanceId: c.user.instanceId, apiKey: '  image-secret  ' });
  assert.equal(JSON.parse(values.get(GLOBAL_IMAGE_SETTINGS_KEY)).imageApiKey, 'image-secret');
  await settings.setTheme({ scope: c.scope, playerInstanceId: c.user.instanceId, themeId: 'light-blue' });
  const row = await c.database.transaction(['phoneUiPreferences'], 'readonly', transaction => transaction.store('phoneUiPreferences').get(`phone-ui-preferences:${c.scope.storyId}:${c.scope.branchId}:${c.user.instanceId}`)); assert.equal('imageApiKey' in row, false);
  assert.equal((await new BetaSettingsService({ database: c.database, globalStorage: storage }).get({ scope: c.scope, playerInstanceId: c.user.instanceId })).imageApiKey, 'image-secret');
  const provider = new PixabayImageProvider({ fetchImpl: async () => ({ ok: true, json: async () => ({ hits: [] }) }) }); assert.equal(provider.capabilities().configured, false); provider.configure({ apiKey: 'image-secret' }); assert.equal(provider.capabilities().available, true); provider.configure({ apiKey: '' }); assert.equal(provider.capabilities().available, false);
});

test('Settings provider section exposes exactly Image API and Voice API as optional capability areas', () => {
  const document = new FakeDocument(); const root = document.createElement('div'); root.append(renderImageProviderSettings({ document, capability: { providerId: 'pixabay', available: false }, configured: false }), renderVoiceProviderHeading({ document, configured: true }));
  assert.deepEqual(root.children.map(node => node.dataset.providerArea), ['image', 'voice']);
  assert.match(root.children[0].children[1].textContent, /ไม่สร้างภาพ/u);
});
