import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { renderNotes } from '../../ui/notes.mjs';
import { renderSearch, localResults } from '../../ui/search.mjs';
import { PhoneShellViewModels } from '../../ui/view-models.mjs';
import { setupPhoneWorldFoundation, ownedInput, utilitySource } from './phone-world-foundation-fixtures.mjs';

function text(node, out = []) { if (node?.textContent) out.push(String(node.textContent)); for (const child of node?.children || []) text(child, out); return out.join(' '); }
function find(node, predicate) { if (predicate(node)) return node; for (const child of node?.children || []) { const hit = find(child, predicate); if (hit) return hit; } return null; }
function action(c, person, recordId, key, extra = {}) { return { scope: c.scope, ...ownedInput(person), recordId, source: utilitySource(key), producer: 'phase23-notes-search-test', idempotencyKey: key, ...extra }; }

async function modelsFor(c) { return new PhoneShellViewModels({ database: c.database, phoneStateService: c.phones, contactService: c.contacts, settingsService: c.settings, messageService: c.messages, callService: c.calls, socialService: c.social, insungramService: c.insungram, liveService: c.live, notificationService: c.notifications, phoneWorldService: c.phoneWorld }); }

test('C2-7 Notes renderer has truthful empty/create/edit/delete-confirm surfaces without fake contextual actions', async () => {
  const c = await setupPhoneWorldFoundation({ manifestId: 'p23-notes-renderer' });
  let root = renderNotes({ document: c.document, items: [] }); assert.match(text(root), /No private notes/); assert.ok(find(root, node => node.dataset?.noteAction === 'new'));
  root = renderNotes({ document: c.document, items: [{ recordId: 'n1', title: 'Door code', text: 'Blue key', pinned: false }], selectedRecordId: 'n1' }); const rendered = text(root); assert.match(rendered, /Door code/); assert.match(rendered, /Blue key/); assert.ok(find(root, node => node.dataset?.noteAction === 'edit')); assert.ok(find(root, node => node.dataset?.noteAction === 'request-delete')); assert.doesNotMatch(rendered, /Call|Message|Add Contact/i);
  root = renderNotes({ document: c.document, items: [{ recordId: 'n1', title: 'Door code', text: 'Blue key' }], selectedRecordId: 'n1', pendingDeleteRecordId: 'n1' }); assert.match(text(root), /Canonical history remains immutable/); assert.ok(find(root, node => node.dataset?.noteAction === 'confirm-delete'));
});

test('C2-7 Search renderer searches local authoritative rows only and never creates a Discover/web facade', async () => {
  const c = await setupPhoneWorldFoundation({ manifestId: 'p23-search-renderer' }); const sources = [
    { kind: 'Note', recordId: 'n1', title: 'Blue key', text: 'Basement door' }, { kind: 'File', recordId: 'f1', title: 'receipt.txt', text: 'tea' }, { kind: 'Contact', recordId: 'c1', title: 'Alice', text: '5551001' },
  ];
  assert.deepEqual(localResults(sources, 'blue').map(row => row.recordId), ['n1']); assert.deepEqual(localResults(sources, '555').map(row => row.recordId), ['c1']); assert.equal(localResults(sources, 'internet-only').length, 0);
  const root = renderSearch({ document: c.document, history: [{ recordId: 'h1', query: 'blue', provider: 'local-phone-world' }], sources, query: 'blue', submittedQuery: 'blue' }); const rendered = text(root);
  assert.match(rendered, /local to authoritative content on this phone/i); assert.match(rendered, /does not fabricate internet results or a Discover feed/i); assert.match(rendered, /Blue key/); assert.ok(find(root, node => node.dataset?.searchAction === 'clear-history')); assert.equal(find(root, node => node.dataset?.searchResultRecordId === 'n1')?.tagName?.toLowerCase?.() === 'button', false);
});

test('C2-7 Notes/Search view-model hydration is selected-device scoped and unauthorized Their Phone returns no private data', async () => {
  const c = await setupPhoneWorldFoundation({ castSize: 2, manifestId: 'p23-notes-search-privacy' }); await c.phoneWorld.saveNote(action(c, c.user, 'note-user', 'note-user', { title: 'USER PRIVATE NOTE', text: 'secret', sourceKind: 'explicit-user' })); await c.phoneWorld.saveNote(action(c, c.alice, 'note-alice', 'note-alice', { title: 'ALICE NOTE', text: 'private', sourceKind: 'explicit-user' })); await c.phoneWorld.recordSearch(action(c, c.user, 'search-user', 'search-user', { query: 'private note', provider: 'local-phone-world', sourceKind: 'explicit-user' }));
  const models = await modelsFor(c); let view = await models.selected({ scope: c.scope, deviceId: c.user.deviceId, playerActorId: c.user.actorId, playerInstanceId: c.user.instanceId, route: 'notes', controller: c.controller }); assert.equal(view.noteItems.length, 1); assert.equal(view.noteItems[0].recordId, 'note-user');
  view = await models.selected({ scope: c.scope, deviceId: c.user.deviceId, playerActorId: c.user.actorId, playerInstanceId: c.user.instanceId, route: 'search', controller: c.controller }); assert.equal(view.searchHistory.length, 1); assert.ok(view.searchSources.some(row => row.recordId === 'note-user')); assert.equal(view.searchSources.some(row => row.recordId === 'note-alice'), false);
  view = await models.selected({ scope: c.scope, deviceId: c.alice.deviceId, playerActorId: c.user.actorId, playerInstanceId: c.user.instanceId, route: 'notes', controller: c.controller }); assert.equal(view.opened.authorization.granted, false); assert.equal(view.noteItems.length, 0);
});

test('C2-7 Notes/Search reject foreign Story/Branch and source/UI contain no Preview/random/web generator path', async () => {
  const c = await setupPhoneWorldFoundation({ manifestId: 'p23-notes-search-scope' }); await assert.rejects(() => c.phoneWorld.saveNote({ ...action(c, c.user, 'foreign-note', 'foreign-note', { title: 'x', text: 'x' }), scope: { storyId: c.scope.storyId, branchId: 'branch_foreign' } }), /Unknown scoped|scope/i); await assert.rejects(() => c.phoneWorld.recordSearch({ ...action(c, c.user, 'foreign-search', 'foreign-search', { query: 'x' }), scope: { storyId: 'story_foreign', branchId: c.scope.branchId } }), /Unknown scoped|scope/i);
  const sources = await Promise.all(['../../ui/notes.mjs', '../../ui/search.mjs', '../../ui/view-models.mjs'].map(url => fs.readFile(new URL(url, import.meta.url), 'utf8'))); for (const source of sources) assert.doesNotMatch(source, /Math\.random|Preview37|preview37|fetch\(|https?:\/\//i);
});

test('C2-7 Notes/Search CSS is mobile-bounded and wraps long private content/query results', async () => {
  const css = await fs.readFile(new URL('../../ui/styles.css', import.meta.url), 'utf8'); assert.match(css, /tmrw-v3-notes,.tmrw-v3-search\{min-width:0/); assert.match(css, /tmrw-v3-note-details pre.*white-space:pre-wrap.*overflow-x:hidden/); assert.match(css, /tmrw-v3-search-form\{min-width:0;display:flex;flex-wrap:wrap/); assert.match(css, /tmrw-v3-shell button\{min-height:44px/);
});
