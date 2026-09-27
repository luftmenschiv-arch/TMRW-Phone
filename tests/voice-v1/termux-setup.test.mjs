import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { extensionTarget } from '../../installers/android/setup.mjs';
import { run } from '../../installers/android/download.mjs';
const repository = 'https://github.com/luftmenschiv-arch/SillyTavern-Extension-TMRW-Phone.git';
async function stFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tmrw-st-setup-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const file of ['server.js', 'start.sh', 'package.json']) await fs.writeFile(path.join(root, file), file === 'package.json' ? '{}' : '');
  return root;
}
test('setup checks ST before downloading and accepts a clean fresh extension path', async t => {
  const st = await stFixture(t);
  const plan = await extensionTarget(st, { commit: 'a'.repeat(40) }); assert.equal(plan.exists, false);
  await assert.rejects(extensionTarget(st + '-missing', { commit: 'a'.repeat(40) }), /sillytavern-not-found/);
  await assert.rejects(extensionTarget(st, { commit: '../main' }), /invalid-extension-release/);
});
test('legacy phone in global or per-user extensions blocks duplicate install; KeyFlow does not', async t => {
  const st = await stFixture(t), parent = path.join(st, 'data', 'default-user', 'extensions');
  const keyflow = path.join(parent, 'keyflow'); await fs.mkdir(keyflow, { recursive: true });
  await fs.writeFile(path.join(keyflow, 'manifest.json'), JSON.stringify({ display_name: 'TMRW KeyFlow' }));
  assert.equal((await extensionTarget(st, { commit: 'a'.repeat(40) })).exists, false);
  const old = path.join(parent, 'some-renamed-extension'); await fs.mkdir(old);
  await fs.writeFile(path.join(old, 'manifest.json'), JSON.stringify({ display_name: 'TMRW Phone' }));
  await assert.rejects(extensionTarget(st, { commit: 'a'.repeat(40) }), /existing-phone-copy/);
});
test('repeat install accepts only matching clean public checkout, preserves modified files', async t => {
  const st = await stFixture(t), target = (await extensionTarget(st, { commit: 'a'.repeat(40) })).target;
  await fs.mkdir(target); await run('git', ['init', target]);
  await run('git', ['-C', target, 'remote', 'add', 'origin', repository]);
  await fs.writeFile(path.join(target, 'user.txt'), 'saved'); await run('git', ['-C', target, 'add', 'user.txt']);
  await run('git', ['-C', target, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture']);
  const commit = (await run('git', ['-C', target, 'rev-parse', 'HEAD'])).trim();
  assert.equal((await extensionTarget(st, { commit })).exists, true);
  await fs.writeFile(path.join(target, 'user.txt'), 'modified-not-disposable');
  await assert.rejects(extensionTarget(st, { commit }), /existing-extension-differs/);
  assert.equal(await fs.readFile(path.join(target, 'user.txt'), 'utf8'), 'modified-not-disposable');
});
