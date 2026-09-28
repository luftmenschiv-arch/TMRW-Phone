import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeDocument } from '../phase7/fake-dom.mjs';
import { refreshThreadKeepingComposer } from '../../v3/ui/shell.mjs';
import { renderMaps } from '../../v3/ui/maps.mjs';

const find = (node, predicate) => {
  if (predicate(node)) return node;
  for (const child of node.children || []) {
    const result = find(child, predicate);
    if (result) return result;
  }
  return null;
};
const named = (root, className) => find(root, node => String(node.className || '').split(/\s+/u).includes(className));
const makeThread = (document, id, message) => {
  const root = document.createElement('div'); root.className = 'tmrw-phone-thread-screen'; root.dataset.threadId = id;
  for (const className of ['tmrw-phone-chat-header', 'tmrw-phone-chat-context', 'tmrw-phone-bubbles']) {
    const part = document.createElement('div'); part.className = className;
    part.append(document.createElement('span'));
    part.children[0].textContent = message;
    root.append(part);
  }
  const composer = document.createElement('div'); composer.className = 'tmrw-v3-message-composer';
  const input = document.createElement('textarea'); input.value = 'ยังพิมพ์ไม่จบ';
  composer.append(input); root.append(composer);
  return { root, composer, input };
};

test('same-thread refresh updates messages without detaching composer or its draft', () => {
  const document = new FakeDocument();
  const screen = document.createElement('section');
  const current = makeThread(document, 'thread-a', 'เก่า'); screen.append(current.root);
  const next = makeThread(document, 'thread-a', 'ใหม่');
  named(current.root, 'tmrw-phone-bubbles').scrollTop = 45;
  assert.equal(refreshThreadKeepingComposer(screen, next.root, 'thread-a'), true);
  assert.equal(current.input.parentNode, current.composer);
  assert.equal(current.composer.parentNode, current.root);
  assert.equal(current.input.value, 'ยังพิมพ์ไม่จบ');
  assert.equal(named(current.root, 'tmrw-phone-bubbles').children[0].textContent, 'ใหม่');
  assert.equal(named(current.root, 'tmrw-phone-bubbles').scrollTop, 45);
});

test('different-thread refresh never reuses the previous composer', () => {
  const document = new FakeDocument();
  const screen = document.createElement('section');
  screen.append(makeThread(document, 'thread-a', 'เก่า').root);
  assert.equal(refreshThreadKeepingComposer(screen, makeThread(document, 'thread-b', 'ใหม่').root, 'thread-b'), false);
});

test('maps typing updates controls in place and does not require a full render', () => {
  const document = new FakeDocument();
  const drafts = [];
  const root = renderMaps({ document, draftLabel: '', selectedAudienceIds: ['person-a'], onDraft: value => drafts.push(value) });
  const input = find(root, node => node.tagName === 'input');
  const checkIn = find(root, node => node.dataset?.locationAction === 'check-in');
  const share = find(root, node => node.dataset?.locationAction === 'share');
  const clear = find(root, node => node.attributes?.get('aria-label') === 'ล้างสถานที่');
  assert.equal(checkIn.disabled, true);
  assert.equal(clear.hidden, true);
  input.value = 'สวน';
  for (const listener of input.listeners.get('input') || []) listener();
  assert.deepEqual(drafts, ['สวน']);
  assert.equal(checkIn.disabled, false);
  assert.equal(share.disabled, false);
  assert.equal(clear.hidden, false);
  clear.click();
  assert.equal(input.value, '');
  assert.equal(checkIn.disabled, true);
  assert.equal(clear.hidden, true);
  assert.deepEqual(drafts, ['สวน', '']);
});
