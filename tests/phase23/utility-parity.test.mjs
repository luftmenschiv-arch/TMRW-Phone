import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PHONE_APP_REGISTRY } from '../../domain/phone/app-registry.mjs';
import { homeViewModel } from '../../ui/home.mjs';

const CURRENT_RELEASE = Object.freeze(['gallery', 'search', 'maps', 'calendar', 'notes', 'files', 'wallet', 'shop', 'weather', 'health', 'theme']);

test('P23 Product-Spec current-release app families remain represented architecturally and are never erased for missing implementation', () => {
  for (const id of CURRENT_RELEASE) {
    const app = PHONE_APP_REGISTRY.find(row => row.id === id);
    assert.ok(app, `${id} must remain in the architectural registry`);
    assert.match(app.kind, /phase23-current/);
    assert.ok(['implementation-required', 'functional'].includes(app.disposition), `${id} disposition`);
  }
});

test('P23 implementation-required apps are not falsely exposed; functional exposure requires both registry qualification and PhoneWorld service readiness', () => {
  const withoutUtilities = new Set(homeViewModel({ developerMode: true, messagingEnabled: true, callsEnabled: true, socialEnabled: true, liveEnabled: true, notificationsEnabled: true, phoneWorldEnabled: false }).map(row => row.id));
  const withUtilities = new Set(homeViewModel({ developerMode: true, messagingEnabled: true, callsEnabled: true, socialEnabled: true, liveEnabled: true, notificationsEnabled: true, phoneWorldEnabled: true, calendarEnabled: true, commerceEnabled: true }).map(row => row.id));
  for (const app of PHONE_APP_REGISTRY.filter(row => row.kind === 'phase23-current')) {
    assert.equal(withoutUtilities.has(app.id), false, `${app.id} must not appear when PhoneWorld service is absent`);
    if (app.disposition === 'implementation-required') {
      assert.equal(app.exposed, false, `${app.id} must stay hidden until functional wiring passes`);
      assert.equal(withUtilities.has(app.id), false, `${app.id} must not leak into launcher before qualification`);
    } else if (app.disposition === 'functional' && app.exposed === true) {
      assert.equal(withUtilities.has(app.id), true, `${app.id} functional route should be discoverable when PhoneWorld service is ready`);
    }
  }
});

test('P23 shared app navigation and mobile launcher layout corrections remain retained during C2 implementation', async () => {
  const css = await fs.readFile(new URL('../../ui/styles.css', import.meta.url), 'utf8');
  const header = await fs.readFile(new URL('../../ui/app-header.mjs', import.meta.url), 'utf8');
  assert.match(header, /dataSet|dataset/);
  assert.match(header, /navAction.*back|navAction = 'back'/);
  assert.match(css, /tmrw-v3-nav:not\(\[hidden\]\)\{display:grid/);
  assert.match(css, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /white-space:normal/);
});
