import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const contract = JSON.parse(await fs.readFile(path.join(here, 'contract.json'), 'utf8'));

test('Preview 37 remains the default, preserved runtime during the beta', () => {
  assert.equal(contract.defaultRuntime, 'preview37');
  assert.equal(contract.preview37.mustRemainInstalled, true);
  assert.equal(contract.preview37.mustRemainAvailable, true);
  assert.equal(contract.preview37.sourceBehaviorMustRemainUnchanged, true);
  assert.equal(contract.preview37.legacyStorageMayBeDeletedDuringBeta, false);
  assert.equal(contract.preview37.legacyStorageMayBeMigratedInPlaceDuringBeta, false);
});

test('future v3 activation is opt-in, isolated, and reversible without a manual backup', () => {
  assert.equal(contract.futureV3.defaultEnabled, false);
  assert.equal(contract.futureV3.mustBeDisableable, true);
  assert.equal(contract.futureV3.storageMustBeIsolated, true);
  assert.equal(contract.futureV3.mayWritePreviewStorage, false);
  assert.equal(contract.futureV3.migrationModeDuringBeta, 'COPY_OR_READ_ONLY');
  assert.equal(contract.futureV3.rollbackRequiresManualBackup, false);
});

test('coexistence prohibits dual authoring and duplicate context injection', () => {
  assert.equal(contract.coexistence.exactlyOneAuthoringRuntimePerStory, true);
  assert.equal(contract.coexistence.exactlyOneContextInjectorPerSourceEvent, true);
  assert.equal(contract.coexistence.previewAndV3MayWriteCanonSimultaneously, false);
});

test('Phase 0 freezes expectations but implements no v3 runtime behavior', () => {
  assert.equal(contract.phase0.implementsActivation, false);
  assert.equal(contract.phase0.implementsStorage, false);
  assert.equal(contract.phase0.implementsMigration, false);
});
