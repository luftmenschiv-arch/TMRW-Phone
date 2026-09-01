import test from 'node:test';
import assert from 'node:assert/strict';
import { TmrwPhoneShell } from '../../ui/shell.mjs';
import { setupPhase7 } from '../phase7/ui-fixtures.mjs';

const settle = () => new Promise(resolve => setImmediate(resolve));
function find(node, predicate) { if (predicate(node)) return node; for (const child of node.children || []) { const hit = find(child, predicate); if (hit) return hit; } return null; }
function findAll(node, predicate, output = []) { if (predicate(node)) output.push(node); for (const child of node.children || []) findAll(child, predicate, output); return output; }

function shellFor(context, selectedDeviceId = context.user.deviceId) {
  return new TmrwPhoneShell({ document: context.document, viewModels: context.viewModels, controller: context.controller, scope: context.scope, playerActorId: context.user.actorId, playerInstanceId: context.user.instanceId, selectedDeviceId });
}

test('P23 My Phone is first, explicitly discoverable, selected by default, and Their Phones remain distinct', async () => {
  const context = await setupPhase7({ castSize: 2, manifestId: 'p23-device-discoverability' });
  const roster = await context.viewModels.deviceRoster(context.scope);
  assert.equal(roster[0].deviceId, context.user.deviceId);
  assert.equal(roster[0].kind, 'my-phone');
  assert.equal(roster.filter(row => row.kind === 'my-phone').length, 1);
  assert.equal(roster.filter(row => row.kind === 'their-phone').length, 2);

  const shell = shellFor(context);
  await shell.mount(context.target);
  const buttons = findAll(shell.root, node => node.dataset?.deviceId);
  assert.equal(buttons[0].textContent, 'My Phone');
  assert.equal(buttons[0].dataset.kind, 'my-phone');
  assert.equal(buttons[0].attributes.get('aria-pressed'), 'true');
  assert.equal(buttons[0].attributes.get('aria-label'), 'My Phone');
  assert.ok(buttons.slice(1).every(button => button.dataset.kind === 'their-phone'));
  assert.ok(buttons.slice(1).every(button => String(button.attributes.get('aria-label')).startsWith('Their Phone:')));
  assert.equal(shell.root.children[0].children[1].textContent, 'My Phone');
});

test('P23 switching perspective uses the real canonical device context and performs no ownership/domain write', async () => {
  const context = await setupPhase7({ castSize: 2, manifestId: 'p23-device-switch' });
  const shell = shellFor(context);
  await shell.mount(context.target);
  const writes = context.database.diagnostics.writeCount;
  await shell.selectDevice(context.alice.deviceId);
  assert.equal(context.database.diagnostics.writeCount, writes);
  const buttons = findAll(shell.root, node => node.dataset?.deviceId);
  const myPhone = buttons.find(button => button.dataset.kind === 'my-phone');
  const alice = buttons.find(button => button.dataset.deviceId === context.alice.deviceId);
  assert.equal(myPhone.attributes.get('aria-pressed'), 'false');
  assert.equal(alice.attributes.get('aria-pressed'), 'true');
  assert.equal(shell.root.children[0].children[1].textContent, "Character 1's Phone");
  const playerPerspective = await context.phones.getPerspective(context.scope, context.user.deviceId);
  const alicePerspective = await context.phones.getPerspective(context.scope, context.alice.deviceId);
  assert.equal(playerPerspective.deviceOwnerActorId, context.user.actorId);
  assert.equal(alicePerspective.deviceOwnerActorId, context.alice.actorId);
  assert.notEqual(playerPerspective.deviceId, alicePerspective.deviceId);
});

test('P23 every non-launcher app uses a real shared Back control and the app-nav is launcher-only', async () => {
  const context = await setupPhase7({ castSize: 1, manifestId: 'p23-back' });
  const shell = shellFor(context);
  await shell.mount(context.target);
  const appNav = shell.root.children[2];
  assert.equal(appNav.hidden, false);
  const contacts = find(shell.root, node => node.dataset?.route === 'contacts');
  contacts.click();
  await settle();
  assert.equal(appNav.hidden, true);
  let panel = shell.root.children[3].children[0];
  assert.equal(panel.dataset.route, 'contacts');
  const back = find(panel, node => node.dataset?.navAction === 'back');
  assert.ok(back);
  assert.equal(back.attributes.get('aria-label'), 'Back');
  back.click();
  await settle();
  assert.equal(appNav.hidden, false);
  panel = shell.root.children[3].children[0];
  assert.equal(panel.dataset.route, 'launcher');
});

test('P23 CSS makes perspective selection and app Back mobile-visible and resists hostile hidden overrides', async () => {
  const css = await import('node:fs/promises').then(fs => fs.readFile(new URL('../../ui/styles.css', import.meta.url), 'utf8'));
  assert.match(css, /tmrw-v3-perspective-summary/);
  assert.match(css, /tmrw-v3-device-switcher button\[data-kind=my-phone\]/);
  assert.match(css, /tmrw-v3-app-header/);
  assert.match(css, /tmrw-v3-app-back/);
  assert.match(css, /tmrw-v3-nav\[hidden\]\{display:none!important\}/);
  assert.match(css, /min-height:44px/);
});
