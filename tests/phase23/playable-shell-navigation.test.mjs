import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewHome } from '../../ui/preview37-surface.mjs';
import { FakeDocument } from '../phase7/fake-dom.mjs';

function find(node, predicate) { if (predicate(node)) return node; for (const child of node?.children || []) { const hit = find(child, predicate); if (hit) return hit; } return null; }
const overview = Object.freeze({ status: 'พร้อมใช้งาน', badges: Object.freeze({}), noteText: null, steps: null });

test('home pager reports swipe-settled page so the shell can restore it after an app closes', async () => {
  const document = new FakeDocument(); const observed = [];
  const root = createPreviewHome({ document, ownerLabel: 'My Phone', overview, homePage: 0, onPage: (page, pager) => observed.push([page, Boolean(pager)]) });
  const pager = find(root, node => node.dataset?.role === 'home-pages'); pager.clientWidth = 300; pager.scrollLeft = 300;
  for (const listener of pager.listeners.get('scroll') || []) listener({ currentTarget: pager });
  await new Promise(resolve => setTimeout(resolve, 90));
  assert.deepEqual(observed.at(-1), [1, false]);
  const dots = find(root, node => String(node.className || '').includes('tmrw-phone-page-dots'));
  assert.equal(dots.children[1].attributes.get('aria-current'), 'true');
});

test('home pager restores the supplied page immediately without waiting for a gesture', () => {
  const document = new FakeDocument(); const observed = [];
  const root = createPreviewHome({ document, ownerLabel: 'Their Phone', overview, homePage: 1, onPage: page => observed.push(page) });
  const dots = find(root, node => String(node.className || '').includes('tmrw-phone-page-dots'));
  assert.equal(dots.children[1].attributes.get('aria-current'), 'true');
  assert.equal(observed.at(-1), 1);
});

test('opening Insungram from the home screen lands in chats', () => {
  const document = new FakeDocument(); let opened = null;
  const root = createPreviewHome({ document, ownerLabel: 'Their Phone', overview, onApp: route => { opened = route; } });
  find(root, node => node.dataset?.app === 'insungram').click();
  assert.equal(opened, 'messages');
});
