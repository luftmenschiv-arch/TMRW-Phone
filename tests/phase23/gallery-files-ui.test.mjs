import test from 'node:test';
import assert from 'node:assert/strict';
import { TmrwPhoneShell } from '../../ui/shell.mjs';
import { PhoneShellViewModels } from '../../ui/view-models.mjs';
import { renderFiles } from '../../ui/files.mjs';
import { setupPhase17 } from '../phase17/notification-fixtures.mjs';
import { setupPhoneWorldFoundation, ownedInput, utilitySource } from './phone-world-foundation-fixtures.mjs';
import { PHONE_WORLD_EVENT_TYPES } from '../../domain/utilities/phone-world-event-types.mjs';

const settle = () => new Promise(resolve => setImmediate(resolve));
async function waitFor(predicate, attempts = 30) { for (let i = 0; i < attempts; i += 1) { if (await predicate()) return; await settle(); } throw new Error('Timed out waiting for UI state'); }
function find(node, predicate) { if (predicate(node)) return node; for (const child of node.children || []) { const hit = find(child, predicate); if (hit) return hit; } return null; }
function findAll(node, predicate, output = []) { if (predicate(node)) output.push(node); for (const child of node.children || []) findAll(child, predicate, output); return output; }

function viewModelsFor(c, phoneWorldService = c.phoneWorld) {
  return new PhoneShellViewModels({ database: c.database, phoneStateService: c.phones, contactService: c.contacts, settingsService: c.settings, phoneWorldService });
}
function shellFor(c, phoneWorldService = c.phoneWorld) {
  return new TmrwPhoneShell({ document: c.document, viewModels: viewModelsFor(c, phoneWorldService), controller: c.controller, scope: c.scope, playerActorId: c.user.actorId, playerInstanceId: c.user.instanceId, selectedDeviceId: c.user.deviceId });
}
async function openRoute(shell, route) {
  const button = find(shell.root, node => node.dataset?.route === route); assert.ok(button, `${route} launcher button`); button.click();
  await waitFor(() => shell.root.children[3]?.children[0]?.dataset?.route === route && !find(shell.root.children[3], node => node.attributes?.get?.('role') === 'status' && String(node.textContent).startsWith('Loading ')));
  return shell.root.children[3].children[0];
}
async function seedSharedAsset(c) {
  await c.phoneWorld.saveGalleryAsset({ scope: c.scope, ...ownedInput(c.user), recordId: 'gallery-shared', label: 'Story photo', assetRef: 'asset:shared-story-photo', provenance: { source: 'story-canon', locationLabel: 'Blue room', takenAt: '18:30' }, source: utilitySource('gallery-shared'), idempotencyKey: 'gallery-shared' });
  await c.phoneWorld.saveFile({ scope: c.scope, ...ownedInput(c.user), recordId: 'file-shared', name: 'Story photo.ref', fileKind: 'asset-ref', assetRef: 'asset:shared-story-photo', folder: 'Shared', provenance: { source: 'explicit-export', originLabel: 'Gallery' }, source: utilitySource('file-shared'), idempotencyKey: 'file-shared' });
  await c.phoneWorld.saveFile({ scope: c.scope, ...ownedInput(c.user), recordId: 'file-text', name: 'Note.txt', fileKind: 'text', contentText: 'Canonical phone-world text', provenance: { source: 'explicit-user', originLabel: 'Files' }, source: utilitySource('file-text'), idempotencyKey: 'file-text' });
  await c.phoneWorld.saveGalleryAsset({ scope: c.scope, ...ownedInput(c.alice), recordId: 'gallery-alice', label: 'Alice private', assetRef: 'asset:alice-private', provenance: { source: 'story-canon' }, source: utilitySource('gallery-alice'), idempotencyKey: 'gallery-alice' });
  await c.phoneWorld.saveFile({ scope: c.scope, ...ownedInput(c.alice), recordId: 'file-alice', name: 'Alice.txt', fileKind: 'text', contentText: 'private', provenance: { source: 'explicit-user' }, source: utilitySource('file-alice'), idempotencyKey: 'file-alice' });
}

test('C2-1 Gallery/Files routes are exposed only with PhoneWorldService and Gallery shows a real loading state', async () => {
  const legacy = await setupPhase17({ castSize: 1, manifestId: 'c2-1-route-gating' });
  const legacyShell = new TmrwPhoneShell({ document: legacy.document, viewModels: legacy.viewModels, controller: legacy.controller, scope: legacy.scope, playerActorId: legacy.user.actorId, playerInstanceId: legacy.user.instanceId, selectedDeviceId: legacy.user.deviceId });
  await legacyShell.mount(legacy.target);
  assert.equal(find(legacyShell.root, node => node.dataset?.route === 'gallery'), null);
  assert.equal(find(legacyShell.root, node => node.dataset?.route === 'files'), null);

  const c = await setupPhoneWorldFoundation({ castSize: 1, manifestId: 'c2-1-loading' });
  let release;
  const delayed = {
    listGallery: () => new Promise(resolve => { release = () => resolve(Object.freeze([])); }),
    listFiles: c.phoneWorld.listFiles.bind(c.phoneWorld), removeGalleryAsset: c.phoneWorld.removeGalleryAsset.bind(c.phoneWorld), removeFile: c.phoneWorld.removeFile.bind(c.phoneWorld),
  };
  const shell = shellFor(c, delayed); await shell.mount(c.target);
  const gallery = find(shell.root, node => node.dataset?.route === 'gallery'); assert.ok(gallery); gallery.click();
  await waitFor(() => Boolean(find(shell.root.children[3], node => node.attributes?.get?.('role') === 'status' && node.textContent === 'Loading Gallery…')));
  release(); await waitFor(() => Boolean(find(shell.root.children[3], node => node.textContent === 'ยังไม่มีรูปที่บันทึกไว้')));
});

test('C2-1 Gallery is device-scoped, opens provenance/assetRef, cancel preserves state, confirm removes only this phone row, and repeated confirm is one-shot', async () => {
  const c = await setupPhoneWorldFoundation({ castSize: 2, manifestId: 'c2-1-gallery' }); await seedSharedAsset(c);
  const shell = shellFor(c); await shell.mount(c.target); let panel = await openRoute(shell, 'gallery');
  const rows = findAll(panel, node => Boolean(node.dataset?.galleryRecordId)); assert.deepEqual(rows.map(row => row.dataset.galleryRecordId), ['gallery-shared']);
  rows[0].click(); await waitFor(() => Boolean(find(shell.root, node => node.dataset?.galleryDetailsId === 'gallery-shared'))); panel = shell.root.children[3].children[0];
  const details = find(panel, node => node.dataset?.galleryDetailsId === 'gallery-shared'); assert.equal(find(details, node => node.tagName === 'h3')?.textContent, 'Story photo'); assert.ok(find(details, node => node.textContent === 'Blue room · 18:30')); assert.equal(find(details, node => node.dataset?.assetRef)?.dataset.assetRef, 'asset:shared-story-photo'); const storedGallery = await c.phoneWorld.listGallery({ scope: c.scope, deviceId: c.user.deviceId }); assert.equal(storedGallery[0].provenance.source, 'story-canon');
  find(details, node => node.dataset?.galleryAction === 'request-remove').click(); await waitFor(() => Boolean(find(shell.root, node => node.dataset?.galleryAction === 'cancel-remove')));
  find(shell.root, node => node.dataset?.galleryAction === 'cancel-remove').click(); await waitFor(() => Boolean(find(shell.root, node => node.dataset?.galleryAction === 'request-remove')));
  assert.equal((await c.phoneWorld.listGallery({ scope: c.scope, deviceId: c.user.deviceId })).length, 1);
  find(shell.root, node => node.dataset?.galleryAction === 'request-remove').click(); await waitFor(() => Boolean(find(shell.root, node => node.dataset?.galleryAction === 'confirm-remove')));
  const confirm = find(shell.root, node => node.dataset?.galleryAction === 'confirm-remove'); confirm.click(); confirm.click();
  await waitFor(async () => (await c.phoneWorld.listGallery({ scope: c.scope, deviceId: c.user.deviceId })).length === 0);
  const files = await c.phoneWorld.listFiles({ scope: c.scope, deviceId: c.user.deviceId }); assert.ok(files.some(row => row.assetRef === 'asset:shared-story-photo'));
  const galleryEvents = (await c.utilityEngine.listEvents(c.scope)).filter(event => event.eventType === PHONE_WORLD_EVENT_TYPES.GALLERY_ITEM_STATE && event.payload.record.recordId === 'gallery-shared'); assert.equal(galleryEvents.length, 2);
});

test('C2-1 Files opens text and shared asset refs with provenance; unsupported renderer state is truthful', async () => {
  const c = await setupPhoneWorldFoundation({ castSize: 2, manifestId: 'c2-1-files-open' }); await seedSharedAsset(c);
  const shell = shellFor(c); await shell.mount(c.target); let panel = await openRoute(shell, 'files');
  const rows = findAll(panel, node => Boolean(node.dataset?.fileRecordId)); assert.deepEqual(rows.map(row => row.dataset.fileRecordId).sort(), ['file-shared', 'file-text']);
  find(panel, node => node.dataset?.fileRecordId === 'file-text').click(); await waitFor(() => Boolean(find(shell.root, node => node.dataset?.fileDetailsId === 'file-text'))); panel = shell.root.children[3].children[0];
  assert.equal(find(panel, node => node.tagName === 'pre')?.textContent, 'Canonical phone-world text'); const storedFiles = await c.phoneWorld.listFiles({ scope: c.scope, deviceId: c.user.deviceId }); assert.equal(storedFiles.find(row => row.recordId === 'file-text')?.provenance?.source, 'explicit-user');
  shell.dispose(); const shell2 = shellFor(c); await shell2.mount(c.target); panel = await openRoute(shell2, 'files'); find(panel, node => node.dataset?.fileRecordId === 'file-shared').click(); await waitFor(() => Boolean(find(shell2.root, node => node.dataset?.fileDetailsId === 'file-shared'))); panel = shell2.root.children[3].children[0];
  assert.equal(find(panel, node => node.dataset?.assetRef)?.dataset.assetRef, 'asset:shared-story-photo');
  const unsupported = renderFiles({ document: c.document, items: [{ recordId: 'unsupported', name: 'Mystery.bin', fileKind: 'binary-unknown', folder: 'root', provenance: { source: 'legacy-unknown' } }], selectedRecordId: 'unsupported' });
  assert.match(find(unsupported, node => node.className === 'tmrw-v3-file-unsupported')?.textContent || '', /Unsupported file type/);
  await assert.rejects(c.phoneWorld.saveFile({ scope: c.scope, ...ownedInput(c.user), recordId: 'bad-file', name: 'Bad', fileKind: 'binary-unknown', source: utilitySource('bad-file'), idempotencyKey: 'bad-file' }), /Unsupported file kind/);
});

test('C2-1 Files remove confirmation is cancellable, one-shot, device-local, and leaves unrelated rows untouched', async () => {
  const c = await setupPhoneWorldFoundation({ castSize: 2, manifestId: 'c2-1-files-remove' }); await seedSharedAsset(c);
  const shell = shellFor(c); await shell.mount(c.target); await openRoute(shell, 'files');
  find(shell.root, node => node.dataset?.fileRecordId === 'file-text').click(); await waitFor(() => Boolean(find(shell.root, node => node.dataset?.fileAction === 'request-remove')));
  find(shell.root, node => node.dataset?.fileAction === 'request-remove').click(); await waitFor(() => Boolean(find(shell.root, node => node.dataset?.fileAction === 'cancel-remove'))); find(shell.root, node => node.dataset?.fileAction === 'cancel-remove').click();
  await waitFor(() => Boolean(find(shell.root, node => node.dataset?.fileAction === 'request-remove'))); assert.equal((await c.phoneWorld.listFiles({ scope: c.scope, deviceId: c.user.deviceId })).length, 2);
  find(shell.root, node => node.dataset?.fileAction === 'request-remove').click(); await waitFor(() => Boolean(find(shell.root, node => node.dataset?.fileAction === 'confirm-remove'))); const confirm = find(shell.root, node => node.dataset?.fileAction === 'confirm-remove'); confirm.click(); confirm.click();
  await waitFor(async () => (await c.phoneWorld.listFiles({ scope: c.scope, deviceId: c.user.deviceId })).length === 1);
  assert.equal((await c.phoneWorld.listFiles({ scope: c.scope, deviceId: c.alice.deviceId })).length, 1);
  const fileEvents = (await c.utilityEngine.listEvents(c.scope)).filter(event => event.eventType === PHONE_WORLD_EVENT_TYPES.FILE_ITEM_STATE && event.payload.record.recordId === 'file-text'); assert.equal(fileEvents.length, 2);
});

test('C2-1 device switch clears selected Gallery/File details and unauthorized Their Phone does not reveal private rows', async () => {
  const c = await setupPhoneWorldFoundation({ castSize: 2, manifestId: 'c2-1-switch' }); await seedSharedAsset(c);
  const shell = shellFor(c); await shell.mount(c.target); await openRoute(shell, 'gallery'); find(shell.root, node => node.dataset?.galleryRecordId === 'gallery-shared').click(); await waitFor(() => Boolean(find(shell.root, node => node.dataset?.galleryDetailsId)));
  await shell.selectDevice(c.alice.deviceId); assert.ok(find(shell.root, node => node.textContent === 'โทรศัพท์เครื่องนี้ยังล็อกอยู่')); assert.equal(find(shell.root, node => node.dataset?.galleryRecordId === 'gallery-alice'), null);
  await shell.selectDevice(c.user.deviceId); assert.equal(find(shell.root, node => node.dataset?.galleryDetailsId), null);
  await openRoute(shell, 'files'); find(shell.root, node => node.dataset?.fileRecordId === 'file-shared').click(); await waitFor(() => Boolean(find(shell.root, node => node.dataset?.fileDetailsId)));
  await shell.selectDevice(c.alice.deviceId); assert.equal(find(shell.root, node => node.dataset?.fileRecordId === 'file-alice'), null); await shell.selectDevice(c.user.deviceId); assert.equal(find(shell.root, node => node.dataset?.fileDetailsId), null);
});

test('C2-1 Gallery/Files CSS keeps narrow layouts bounded and touch/accessibility controls explicit', async () => {
  const css = await import('node:fs/promises').then(fs => fs.readFile(new URL('../../ui/styles.css', import.meta.url), 'utf8'));
  assert.match(css, /tmrw-v3-gallery-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /tmrw-v3-gallery-item,.tmrw-v3-files-list button\{width:100%;min-width:0;white-space:normal!important/);
  assert.match(css, /tmrw-v3-file-details pre\{max-width:100%/);
  assert.match(css, /overflow-x:hidden/);
  assert.match(css, /\.tmrw-v3-shell button\{min-height:44px/);
});
