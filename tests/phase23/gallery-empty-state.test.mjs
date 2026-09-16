import assert from 'node:assert/strict';
import test from 'node:test';
import { FakeDocument } from '../phase7/fake-dom.mjs';
import { renderGallery } from '../../ui/gallery.mjs';

function text(node, output = []) { if (node?.textContent) output.push(node.textContent); for (const child of node?.children || []) text(child, output); return output.join(' '); }

test('empty Gallery renders one designed contact-sheet state instead of a loose fallback sentence', () => {
  const document = new FakeDocument();
  const root = renderGallery({ document, items: [] });
  const empty = root.children[0];
  assert.equal(empty.dataset.state, 'empty');
  assert.equal(empty.children[0].children.length, 5);
  assert.match(text(empty.children[1]), /อัลบั้มยังว่างอยู่/u);
  assert.doesNotMatch(text(root), /ยังไม่มีรูปที่บันทึกไว้/u);
});
