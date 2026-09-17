import assert from 'node:assert/strict';
import test from 'node:test';
import { APP_EMPTY_COPY, renderAppEmptyState, renderInlineNotice } from '../../ui/app-empty-state.mjs';
import { renderFiles } from '../../ui/files.mjs';
import { FakeDocument } from '../phase7/fake-dom.mjs';

function find(node, predicate) { if (predicate(node)) return node; for (const child of node.children || []) { const found = find(child, predicate); if (found) return found; } return null; }

test('every app empty-state preset renders an intentional visual scene and useful copy', () => {
  const document = new FakeDocument();
  for (const app of Object.keys(APP_EMPTY_COPY)) {
    const state = renderAppEmptyState({ document, app });
    assert.equal(state.dataset.emptyApp, app); assert.match(state.className, /tmrw-phone-app-empty/u);
    const art = find(state, node => node.className === 'tmrw-phone-app-empty-art');
    assert.ok(art); assert.equal(art.children.length, 5); assert.ok(state.countNodes() >= 9);
  }
});

test('Files uses the shared full empty scene instead of an orphan sentence', () => {
  const document = new FakeDocument(); const root = renderFiles({ document, items: [] });
  assert.ok(find(root, node => node.dataset?.emptyApp === 'files'));
  assert.equal(find(root, node => node.tagName === 'p' && node.parentNode === root), null);
});

test('inline notices hide raw implementation errors behind a human recovery message', () => {
  const document = new FakeDocument(); const notice = renderInlineNotice({ document, tone: 'error', title: 'ลองใหม่ได้เลย', detail: 'ข้อมูลเดิมยังอยู่' });
  assert.equal(notice.attributes.get('role'), 'alert'); assert.equal(Boolean(find(notice, node => node.textContent.includes('Authoring capability'))), false);
});
