import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeDocument } from '../phase7/fake-dom.mjs';
import { renderLivingState } from '../../ui/living-state.mjs';

test('shared living states expose consistent accessible loading, empty, error, offline, and ready presentations', () => {
  const document = new FakeDocument();
  for (const state of ['loading', 'empty', 'error', 'offline', 'ready']) {
    const node = renderLivingState({ document, state });
    assert.equal(node.dataset.state, state);
    assert.ok(node.children.length >= 3);
  }
  assert.equal(renderLivingState({ document, state: 'loading' }).attributes.get('role'), 'status');
  assert.equal(renderLivingState({ document, state: 'error' }).attributes.get('role'), 'alert');
});
