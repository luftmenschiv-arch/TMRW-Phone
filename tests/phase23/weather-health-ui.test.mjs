import test from 'node:test';
import assert from 'node:assert/strict';
import { PhoneShellViewModels } from '../../ui/view-models.mjs';
import { TmrwPhoneShell } from '../../ui/shell.mjs';
import { setupPhoneWorldFoundation, ownedInput, utilitySource } from './phone-world-foundation-fixtures.mjs';

const settle = () => new Promise(resolve => setImmediate(resolve));
async function waitFor(predicate) { for (let index = 0; index < 120; index += 1) { if (await predicate()) return; await settle(); } throw new Error('Weather/Health UI did not settle'); }
function find(node, predicate) { if (predicate(node)) return node; for (const child of node.children || []) { const hit = find(child, predicate); if (hit) return hit; } return null; }
function allText(node, out = []) { if (node?.textContent) out.push(String(node.textContent)); for (const child of node?.children || []) allText(child, out); return out.join(' '); }
function action(c, person, recordId, key, extra = {}) { return { scope: c.scope, ...ownedInput(person), recordId, source: utilitySource(key), producer: 'phase23-weather-health-ui', idempotencyKey: key, ...extra }; }

async function setupObservationUi(manifestId, { weatherList = null, healthList = null } = {}) {
  const c = await setupPhoneWorldFoundation({ castSize: 2, manifestId });
  const phoneWorldService = weatherList || healthList ? {
    listWeather: input => weatherList ? weatherList(input, c.phoneWorld) : c.phoneWorld.listWeather(input),
    listHealth: input => healthList ? healthList(input, c.phoneWorld) : c.phoneWorld.listHealth(input),
  } : c.phoneWorld;
  const viewModels = new PhoneShellViewModels({ database: c.database, phoneStateService: c.phones, contactService: c.contacts, settingsService: c.settings, messageService: c.messages, callService: c.calls, socialService: c.social, insungramService: c.insungram, liveService: c.live, notificationService: c.notifications, phoneWorldService });
  return { ...c, viewModels };
}
function shellFor(c) { return new TmrwPhoneShell({ document: c.document, viewModels: c.viewModels, controller: c.controller, messageService: c.messages, callService: c.calls, callCoordinator: c.viewModels.callCoordinator, socialService: c.social, notificationService: c.notifications, scope: c.scope, playerActorId: c.user.actorId, playerInstanceId: c.user.instanceId, selectedDeviceId: c.user.deviceId }); }
async function open(shell, route) { const button = find(shell.root, node => node.dataset?.route === route); assert.ok(button, `missing ${route}`); button.click(); await settle(); return shell.root.children[3].children[0]; }

test('C2-6 Weather shell exposes loading, truthful no-data state, and real Back', async () => {
  let release;
  const c = await setupObservationUi('p23-weather-loading', { weatherList: (input, real) => new Promise((resolve, reject) => { release = () => real.listWeather(input).then(resolve, reject); }) });
  const shell = shellFor(c); await shell.mount(c.target); const button = find(shell.root, node => node.dataset?.route === 'weather'); assert.ok(button); button.click();
  await waitFor(() => /Loading Weather/.test(allText(shell.root))); release(); await waitFor(() => /Weather unavailable/.test(allText(shell.root)));
  const panel = shell.root.children[3].children[0]; assert.match(allText(panel), /ยังไม่มีข้อมูลสภาพอากาศ/); assert.equal(find(panel, node => node.className === 'tmrw-phone-weather-forecast'), null); const back = find(panel, node => node.dataset?.navAction === 'back'); assert.ok(back); back.click(); await settle(); assert.equal(shell.root.children[2].hidden, false);
});

test('C2-6 Weather shell renders canonical condition/location/provider/time only and no forecast panel', async () => {
  const c = await setupObservationUi('p23-weather-explicit'); await c.phoneWorld.recordWeather(action(c, c.user, 'weather-1', 'weather-1', { locationLabel: 'Story station concourse with an intentionally very long location label', condition: 'Light rain', temperatureC: 22.25, provider: 'Canonical Story Weather Provider With Long Provenance Text', observedAt: 'Story Day 8 · 21:15', sourceKind: 'story-canon' }));
  const shell = shellFor(c); await shell.mount(c.target); const panel = await open(shell, 'weather'); const rendered = allText(panel);
  assert.match(rendered, /Light rain/); assert.match(rendered, /22.25°/); assert.match(rendered, /Story station concourse with an intentionally very long location label/); assert.match(rendered, /Story Day 8 · 21:15/); const stored = await c.phoneWorld.listWeather({ scope: c.scope, deviceId: c.user.deviceId }); assert.equal(stored[0].provider, 'Canonical Story Weather Provider With Long Provenance Text'); assert.doesNotMatch(rendered, /Hourly forecast|Tomorrow|humidity|wind|sunrise|sunset|precipitation/i);
});

test('C2-6 Weather authorized→authorized device switch replaces prior observation with loading before hydrating next device', async () => {
  let releaseAlice = null;
  const c = await setupObservationUi('p23-weather-switch', { weatherList: (input, real) => input.deviceId === c?.alice?.deviceId && !releaseAlice ? new Promise((resolve, reject) => { releaseAlice = () => real.listWeather(input).then(resolve, reject); }) : real.listWeather(input) });
  await c.phoneWorld.recordWeather(action(c, c.user, 'weather-user', 'weather-user-switch', { locationLabel: 'USER PRIVATE WEATHER', condition: 'Cloudy', temperatureC: 18, sourceKind: 'story-canon' }));
  await c.phoneWorld.recordWeather(action(c, c.alice, 'weather-alice', 'weather-alice-switch', { locationLabel: 'ALICE WEATHER', condition: 'Clear', temperatureC: 26, sourceKind: 'story-canon' }));
  await c.overrides.grant({ scope: c.scope, deviceId: c.alice.deviceId, action: 'inspect', playerActorId: c.user.actorId, playerInstanceId: c.user.instanceId });
  const shell = shellFor(c); await shell.mount(c.target); await open(shell, 'weather'); assert.match(allText(shell.root), /USER PRIVATE WEATHER/);
  const switching = shell.selectDevice(c.alice.deviceId); await waitFor(() => /Loading Weather/.test(allText(shell.root))); assert.doesNotMatch(allText(shell.root), /USER PRIVATE WEATHER/); releaseAlice(); await switching; assert.match(allText(shell.root), /ALICE WEATHER/);
});

test('C2-6 Weather unauthorized target and read failure never reveal stale prior-device observation', async () => {
  const c = await setupObservationUi('p23-weather-unauthorized'); await c.phoneWorld.recordWeather(action(c, c.user, 'weather-private', 'weather-private', { locationLabel: 'SECRET WEATHER LABEL', condition: 'Fog', temperatureC: 10, sourceKind: 'story-canon' }));
  const shell = shellFor(c); await shell.mount(c.target); await open(shell, 'weather'); assert.match(allText(shell.root), /SECRET WEATHER LABEL/); await shell.selectDevice(c.alice.deviceId); assert.match(allText(shell.root), /โทรศัพท์เครื่องนี้ยังล็อกอยู่/); assert.doesNotMatch(allText(shell.root), /SECRET WEATHER LABEL/);
  const failed = await setupObservationUi('p23-weather-error', { weatherList: async () => { throw new Error('Injected observation read failure'); } }); const failedShell = shellFor(failed); await failedShell.mount(failed.target); const panel = await open(failedShell, 'weather'); assert.match(allText(panel), /Weather error: Injected observation read failure/); assert.equal(find(panel, node => node.attributes?.get?.('role') === 'status'), null);
});

test('C2-6 Health shell exposes loading, no-data/unavailable metrics, and real Back', async () => {
  let release;
  const c = await setupObservationUi('p23-health-loading', { healthList: (input, real) => new Promise((resolve, reject) => { release = () => real.listHealth(input).then(resolve, reject); }) });
  const shell = shellFor(c); await shell.mount(c.target); const button = find(shell.root, node => node.dataset?.route === 'health'); assert.ok(button); button.click(); await waitFor(() => /Loading Health/.test(allText(shell.root))); release(); await waitFor(() => /Health unavailable/.test(allText(shell.root)));
  const panel = shell.root.children[3].children[0]; const rendered = allText(panel); assert.match(rendered, /ยังไม่มีข้อมูลสุขภาพ/); assert.equal(find(panel, node => node.dataset?.healthMetric), null); assert.ok(find(panel, node => node.dataset?.navAction === 'back'));
});

test('C2-6 Health shell renders each explicit metric independently with provenance/time and leaves no missing metric as zero', async () => {
  const c = await setupObservationUi('p23-health-explicit'); const rows = [
    ['steps', 5432, 'steps'], ['calories', 310, 'kcal'], ['exercise-minutes', 42, 'min'], ['sleep-minutes', 455, 'min'], ['heart-rate', 68, 'bpm'],
  ]; for (const [metric, value, unit] of rows) await c.phoneWorld.recordHealth(action(c, c.user, `health-${metric}`, `health-${metric}`, { metric, value, unit, sourceLabel: `Explicit ${metric} story record`, observedAt: 'Story Day 9 · morning', sourceKind: 'story-canon' }));
  const shell = shellFor(c); await shell.mount(c.target); const panel = await open(shell, 'health'); const rendered = allText(panel);
  for (const [, value, unit] of rows) assert.match(rendered, new RegExp(`${value} ${unit}`)); assert.equal(find(panel, node => node.textContent === 'Health unavailable'), null); assert.match(rendered, /Story Day 9 · morning/); const stored = await c.phoneWorld.listHealth({ scope: c.scope, deviceId: c.user.deviceId }); assert.equal(stored.find(row => row.metric === 'steps')?.sourceLabel, 'Explicit steps story record');
});

test('C2-6 Health authorized→authorized and authorized→unauthorized switches clear old metric presentation before hydration', async () => {
  let releaseAlice = null;
  const c = await setupObservationUi('p23-health-switch', { healthList: (input, real) => input.deviceId === c?.alice?.deviceId && !releaseAlice ? new Promise((resolve, reject) => { releaseAlice = () => real.listHealth(input).then(resolve, reject); }) : real.listHealth(input) });
  await c.phoneWorld.recordHealth(action(c, c.user, 'health-user', 'health-user-switch', { metric: 'steps', value: 1111, unit: 'steps', sourceLabel: 'USER PRIVATE HEALTH', sourceKind: 'story-canon' })); await c.phoneWorld.recordHealth(action(c, c.alice, 'health-alice', 'health-alice-switch', { metric: 'steps', value: 2222, unit: 'steps', sourceLabel: 'ALICE HEALTH', sourceKind: 'story-canon' }));
  await c.overrides.grant({ scope: c.scope, deviceId: c.alice.deviceId, action: 'inspect', playerActorId: c.user.actorId, playerInstanceId: c.user.instanceId }); const shell = shellFor(c); await shell.mount(c.target); await open(shell, 'health'); assert.match(allText(shell.root), /1111 steps/); const switching = shell.selectDevice(c.alice.deviceId); await waitFor(() => /Loading Health/.test(allText(shell.root))); assert.doesNotMatch(allText(shell.root), /1111 steps/); releaseAlice(); await switching; assert.match(allText(shell.root), /2222 steps/);
  const c2 = await setupObservationUi('p23-health-unauthorized'); await c2.phoneWorld.recordHealth(action(c2, c2.user, 'health-private', 'health-private', { metric: 'heart-rate', value: 77, unit: 'bpm', sourceLabel: 'SECRET HEALTH', sourceKind: 'story-canon' })); const shell2 = shellFor(c2); await shell2.mount(c2.target); await open(shell2, 'health'); await shell2.selectDevice(c2.alice.deviceId); assert.match(allText(shell2.root), /โทรศัพท์เครื่องนี้ยังล็อกอยู่/); assert.doesNotMatch(allText(shell2.root), /SECRET HEALTH/);
});

test('C2-6 Health read failure is recoverable and launcher exposes both apps only with PhoneWorld readiness', async () => {
  const c = await setupObservationUi('p23-health-error', { healthList: async () => { throw new Error('Injected Health read failure'); } }); const shell = shellFor(c); await shell.mount(c.target); const panel = await open(shell, 'health'); assert.match(allText(panel), /Health error: Injected Health read failure/); assert.equal(find(panel, node => node.attributes?.get?.('role') === 'status'), null);
  assert.ok(find(shell.root, node => node.dataset?.route === 'weather')); assert.ok(find(shell.root, node => node.dataset?.route === 'health'));
});
