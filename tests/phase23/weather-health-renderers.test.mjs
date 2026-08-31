import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { renderWeather } from '../../ui/weather.mjs';
import { renderHealth } from '../../ui/health.mjs';
import { PhoneShellViewModels } from '../../ui/view-models.mjs';
import { setupPhoneWorldFoundation, ownedInput, utilitySource } from './phone-world-foundation-fixtures.mjs';

function text(node, out = []) { if (node?.textContent) out.push(String(node.textContent)); for (const child of node?.children || []) text(child, out); return out.join(' '); }
function action(c, person, recordId, key, extra = {}) { return { scope: c.scope, ...ownedInput(person), recordId, source: utilitySource(key), producer: 'phase23-weather-health-test', idempotencyKey: key, ...extra }; }

async function viewModelsFor(c) {
  return new PhoneShellViewModels({ database: c.database, phoneStateService: c.phones, contactService: c.contacts, settingsService: c.settings, messageService: c.messages, callService: c.calls, socialService: c.social, insungramService: c.insungram, liveService: c.live, notificationService: c.notifications, phoneWorldService: c.phoneWorld });
}

test('C2-6 Weather renderer is truthful with no data and renders only explicit observation metadata', async () => {
  const c = await setupPhoneWorldFoundation({ manifestId: 'p23-weather-renderer' });
  let root = renderWeather({ document: c.document, items: [] });
  assert.match(text(root), /No explicit weather observation/);
  assert.match(text(root), /does not generate forecasts or claim device GPS/i);
  assert.doesNotMatch(text(root), /humidity|wind|sunrise|sunset|precipitation/i);
  root = renderWeather({ document: c.document, items: [{ recordId: 'weather-1', condition: 'Light rain', temperatureC: 21.5, locationLabel: 'Old Town story scene', provider: 'Story Weather Feed', sourceKind: 'story-canon', observedAt: 'Story Day 4 · 18:30' }] });
  const rendered = text(root);
  assert.match(rendered, /Light rain/); assert.match(rendered, /21.5 °C/); assert.match(rendered, /Story\/provider location: Old Town story scene/); assert.match(rendered, /Story Weather Feed/); assert.match(rendered, /Story Day 4 · 18:30/);
  assert.doesNotMatch(rendered, /Tomorrow|Hourly forecast|7-day|humidity|wind|sunrise|sunset|precipitation|current device location/i);
});

test('C2-6 Health renderer keeps every metric independent; missing never becomes zero', async () => {
  const c = await setupPhoneWorldFoundation({ manifestId: 'p23-health-renderer' });
  let root = renderHealth({ document: c.document, items: [] }); let rendered = text(root);
  assert.match(rendered, /No explicit Health observations/); assert.match(rendered, /does not claim real-device sensor readings or medical validity/i);
  assert.equal((rendered.match(/Unavailable — no explicit observation/g) || []).length, 5);
  root = renderHealth({ document: c.document, items: [
    { metric: 'steps', value: 4321, unit: 'steps', sourceLabel: 'Story activity log', observedAt: 'Story Day 4' },
    { metric: 'heart-rate', value: 72, unit: 'bpm', sourceLabel: 'Explicit scene record', observedAt: 'Story Day 4 · 18:31' },
  ] }); rendered = text(root);
  assert.match(rendered, /4321 steps/); assert.match(rendered, /72 bpm/); assert.match(rendered, /Story activity log/); assert.match(rendered, /Explicit scene record/);
  assert.equal((rendered.match(/Unavailable — no explicit observation/g) || []).length, 3);
  assert.doesNotMatch(rendered, /Calories 0|Exercise 0|Sleep 0/);
});

test('C2-6 explicit Weather/Health projections stay device-private through the normal phone-access view-model boundary', async () => {
  const c = await setupPhoneWorldFoundation({ castSize: 2, manifestId: 'p23-observation-privacy' });
  await c.phoneWorld.recordWeather(action(c, c.user, 'weather-user', 'weather-user', { locationLabel: 'Private user scene', condition: 'Cloudy', temperatureC: 19, observedAt: 'story-t1', provider: 'Story feed', sourceKind: 'story-canon' }));
  await c.phoneWorld.recordHealth(action(c, c.user, 'health-user', 'health-user', { metric: 'steps', value: 1000, unit: 'steps', observedAt: 'story-t1', sourceLabel: 'Explicit user observation', sourceKind: 'story-canon' }));
  await c.phoneWorld.recordWeather(action(c, c.alice, 'weather-alice', 'weather-alice', { locationLabel: 'Alice private scene', condition: 'Clear', temperatureC: 25, observedAt: 'story-t2', provider: 'Story feed', sourceKind: 'story-canon' }));
  const models = await viewModelsFor(c);
  const userWeather = await models.selected({ scope: c.scope, deviceId: c.user.deviceId, playerActorId: c.user.actorId, playerInstanceId: c.user.instanceId, route: 'weather', controller: c.controller });
  assert.equal(userWeather.weatherItems.length, 1); assert.equal(userWeather.weatherItems[0].recordId, 'weather-user');
  const userHealth = await models.selected({ scope: c.scope, deviceId: c.user.deviceId, playerActorId: c.user.actorId, playerInstanceId: c.user.instanceId, route: 'health', controller: c.controller });
  assert.equal(userHealth.healthItems.length, 1); assert.equal(userHealth.healthItems[0].recordId, 'health-user');
  const aliceUnauthorized = await models.selected({ scope: c.scope, deviceId: c.alice.deviceId, playerActorId: c.user.actorId, playerInstanceId: c.user.instanceId, route: 'weather', controller: c.controller });
  assert.equal(aliceUnauthorized.opened.authorization.granted, false); assert.equal(aliceUnauthorized.weatherItems.length, 0);
});

test('C2-6 Weather/Health writes reject foreign Story/Branch and no renderer or projection path imports Preview/mock/random data', async () => {
  const c = await setupPhoneWorldFoundation({ manifestId: 'p23-observation-scope' });
  await assert.rejects(() => c.phoneWorld.recordWeather({ ...action(c, c.user, 'foreign-story', 'foreign-story', { locationLabel: 'x', condition: 'x', temperatureC: 1 }), scope: { storyId: 'story_foreign', branchId: c.scope.branchId } }), /Unknown scoped|scope/i);
  await assert.rejects(() => c.phoneWorld.recordHealth({ ...action(c, c.user, 'foreign-branch', 'foreign-branch', { metric: 'steps', value: 1, unit: 'steps' }), scope: { storyId: c.scope.storyId, branchId: 'branch_foreign' } }), /Unknown scoped|scope/i);
  const sources = await Promise.all(['../../ui/weather.mjs', '../../ui/health.mjs', '../../domain/utilities/phone-world-service.mjs', '../../domain/utilities/phone-world-projector.mjs'].map(url => fs.readFile(new URL(url, import.meta.url), 'utf8')));
  for (const source of sources) { assert.doesNotMatch(source, /Math\.random|Preview37|preview37|mock weather|mock health/i); }
});

test('C2-6 Weather/Health CSS is narrow-safe and wraps provider/location/metric/timestamp text', async () => {
  const css = await fs.readFile(new URL('../../ui/styles.css', import.meta.url), 'utf8');
  assert.match(css, /tmrw-v3-weather,.tmrw-v3-health\{min-width:0/);
  assert.match(css, /tmrw-v3-weather-list li,.tmrw-v3-health-metric\{min-width:0/);
  assert.match(css, /overflow-wrap:anywhere/);
  assert.match(css, /tmrw-v3-shell button\{min-height:44px/);
});
