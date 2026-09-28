import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createVoiceSupervisor } from '../../installers/android/voice-supervisor.mjs';
import { installVoiceBootstrap, enableServerPlugins } from '../../installers/android/install-voice-bootstrap.mjs';
import { withRuntimeMaintenance } from '../../voice-manager/src/runtime-maintenance.mjs';

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmrw-bootstrap-'));
  t.after(() => fs.rm(dir, { force: true, recursive: true }));
  const config = { st: path.join(dir, 'ST'), root: path.join(dir, 'voice'), runtimePort: 18769, managerPort: 18768 };
  await fs.mkdir(config.st); await fs.mkdir(config.root);
  await fs.writeFile(path.join(config.st, 'config.yaml'), 'port: 8000\n# Keep this comment\nenableServerPlugins: false # original\n');
  return config;
}
const health = (present, ready = present) => async url => {
  if (!present) throw new Error('offline');
  return new Response(JSON.stringify({ ok: true, ready, ...(url.includes('/v1/') ? { service: 'TMRW Voice Manager' } : { voice: 'TMRW Local Voice' }) }));
};

test('concurrent startup requests share one launch; already-loading engine is not duplicated', async t => {
  const config = await fixture(t); let launched = 0, online = false, release;
  const gate = new Promise(resolve => { release = resolve; });
  const supervisor = createVoiceSupervisor(config, { fetchImpl: url => health(online, false)(url), start: async () => { launched++; await gate; online = true; } });
  const first = supervisor.ensure(); const second = supervisor.ensure();
  assert.equal(first, second); release();
  assert.equal((await first).phase, 'starting'); assert.equal(launched, 1);
  await supervisor.ensure(); assert.equal(launched, 1);
});
test('a dead service recovers; persistent failure backs off; explicit stop remains stopped', async t => {
  const config = await fixture(t); let online = true, launches = 0, clock = 1000, fail = false;
  const supervisor = createVoiceSupervisor(config, { now: () => clock, fetchImpl: url => health(online)(url), start: async () => { launches++; if (fail) throw new Error('failed'); online = true; } });
  assert.equal((await supervisor.ensure()).ready, true); assert.equal(launches, 0);
  online = false; assert.equal((await supervisor.ensure()).ready, true); assert.equal(launches, 1);
  online = false; fail = true;
  assert.equal((await supervisor.ensure()).phase, 'failed');
  await supervisor.ensure(); assert.equal(launches, 2);
  clock += 30001; await supervisor.ensure(); assert.equal(launches, 3);
  await fs.writeFile(path.join(config.root, 'voice-autostart-paused.json'), '{}');
  clock += 400000; assert.equal((await supervisor.ensure()).phase, 'paused'); assert.equal(launches, 3);
});
test('another live launcher lock prevents a duplicate start', async t => {
  const config = await fixture(t); let launches = 0;
  await fs.writeFile(path.join(config.root, 'start.lock'), JSON.stringify({ pid: process.pid }));
  const supervisor = createVoiceSupervisor(config, { fetchImpl: health(false), start: async () => { launches++; } });
  assert.equal((await supervisor.ensure()).phase, 'starting'); assert.equal(launches, 0);
});
test('voice clone keeps the watchdog out while runtime is deliberately stopped and resumes after failure', async t => {
  const config = await fixture(t); let runtimeOnline = true, launches = 0;
  const supervisor = createVoiceSupervisor(config, {
    fetchImpl: url => health(url.includes('/v1/') || runtimeOnline)(url),
    start: async () => { launches++; runtimeOnline = true; },
  });
  await assert.rejects(withRuntimeMaintenance(config.root, async () => {
    runtimeOnline = false;
    const state = await supervisor.ensure();
    assert.equal(state.phase, 'maintenance');
    assert.equal(launches, 0);
    throw new Error('clone-extraction-failed');
  }), /clone-extraction-failed/);
  assert.equal(await fs.stat(path.join(config.root, 'voice-runtime-maintenance.json')).catch(() => null), null);
  assert.equal((await supervisor.ensure()).ready, true);
  assert.equal(launches, 1);
});
test('voice clone waits for an already running startup before stopping the runtime', async t => {
  const config = await fixture(t); let releaseStartup, enteredClone = false;
  const startup = new Promise(resolve => { releaseStartup = resolve; });
  let online = false;
  const supervisor = createVoiceSupervisor(config, {
    fetchImpl: url => health(url.includes('/v1/') || online)(url),
    start: async () => { await startup; online = true; },
  });
  const starting = supervisor.ensure();
  while (!await fs.stat(path.join(config.root, 'start.lock')).catch(() => null)) await new Promise(resolve => setTimeout(resolve, 5));
  const cloning = withRuntimeMaintenance(config.root, async () => { enteredClone = true; });
  assert.equal((await supervisor.status()).phase, 'maintenance');
  assert.equal(enteredClone, false);
  releaseStartup(); await starting; await cloning;
  assert.equal(enteredClone, true);
});
test('installer preserves ST settings, backs up once, repeats cleanly, and exports a loadable ST plugin', async t => {
  const config = await fixture(t);
  const before = await fs.readFile(path.join(config.st, 'config.yaml'), 'utf8');
  const a = await installVoiceBootstrap(config); const b = await installVoiceBootstrap(config);
  assert.equal(a.id, b.id);
  assert.equal(await fs.readFile(path.join(config.st, 'config.yaml'), 'utf8'), before.replace('false # original', 'true # original'));
  const backups = (await fs.readdir(config.st)).filter(name => name.endsWith('.bak'));
  assert.equal(backups.length, 1); assert.equal(await fs.readFile(path.join(config.st, backups[0]), 'utf8'), before);
  const plugin = await import(pathToFileURL(path.join(config.st, 'plugins/tmrw-voice-bootstrap/index.mjs')));
  assert.equal(plugin.info.id, 'tmrw-voice-bootstrap'); assert.equal(typeof plugin.init, 'function');
  // A paused fixture allows testing real plugin initialization without running a model.
  await fs.writeFile(path.join(config.root, 'voice-autostart-paused.json'), '{}');
  const routes = new Map();
  await plugin.init({ get: (url, handler) => routes.set(url, handler), post: (url, handler) => routes.set(url, handler) });
  plugin.exit();
  assert.ok(routes.has('/status')); assert.ok(routes.has('/ensure'));
});
test('installer refuses silently activating unrelated plugins or overwriting an unmanaged helper', async t => {
  const config = await fixture(t);
  await fs.mkdir(path.join(config.st, 'plugins')); await fs.writeFile(path.join(config.st, 'plugins/other.mjs'), '');
  await assert.rejects(installVoiceBootstrap(config), /review-existing/);
  assert.match(await fs.readFile(path.join(config.st, 'config.yaml'), 'utf8'), /false/);
  assert.throws(() => enableServerPlugins('enableServerPlugins: false\nenableServerPlugins: true'), /duplicate/);
});
