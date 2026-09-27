import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { autoUpdate, updateVoice, updateExtension, recoverPending, validateChannel, fetchIndex, extensionPath, REPOSITORY } from '../../installers/android/auto-update.mjs';
import { run } from '../../installers/android/download.mjs';
import { installLauncher, engineFiles } from '../../installers/android/launcher-tools.mjs';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const idle = async () => false;
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tmrw-updater-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const config = { root: path.join(directory, 'voice'), st: path.join(directory, 'ST'), runtimePort: 18779, managerPort: 18778 };
  await fs.mkdir(path.join(config.root, 'profiles'), { recursive: true });
  await fs.writeFile(path.join(config.root, 'profiles', 'mine.npz'), 'my voice');
  await fs.writeFile(path.join(config.root, 'history.json'), 'my history');
  const previous = { id: 'tmrw-local-voice-android-arm64', version: '1.0.0-beta.1', sha256: 'a'.repeat(64), target: path.join(config.root, 'packs', 'old') };
  await fs.mkdir(previous.target, { recursive: true });
  await fs.writeFile(path.join(config.root, 'active-pack.json'), JSON.stringify(previous));
  const candidate = { ...previous, version: '1.0.0-beta.2', sha256: 'b'.repeat(64), target: path.join(config.root, 'packs', 'new') };
  const index = { schema: 'tmrw-termux-install-v1', baseUrl: `${REPOSITORY}/releases/download/v0.1.0-beta.5/`, qualification: { publishApproved: true }, packs: [{ ...candidate, rootDirectory: 'android-arm64', size: 1, unpackedBytes: 1, parts: [{ index: 0, url: 'runtime.part-00000', size: 1, sha256: 'c'.repeat(64) }] }] };
  const body = JSON.stringify(index);
  const channel = { schema: 'tmrw-voice-update-v1', protocol: 1, id: previous.id, version: candidate.version, sha256: candidate.sha256, indexUrl: `${index.baseUrl}install-index.json`, indexSha256: hash(body) };
  const calls = [];
  const options = { fetchImpl: async () => new Response(body), install: async args => { assert.equal(args.activate, false); calls.push('prepare'); await fs.mkdir(candidate.target, { recursive: true }); return { target: candidate.target, activation: candidate }; }, services: async (_c, a, action) => calls.push(`${action}:${a.version}`), doctor: async () => {}, busy: idle };
  return { directory, config, previous, candidate, channel, body, options, calls };
}
test('update metadata accepts only reviewed public HTTPS index; rejects protocol, hash and foreign parts', async t => {
  const f = await fixture(t); assert.equal(validateChannel(f.channel), f.channel);
  for (const changes of [{ protocol: 2 }, { indexUrl: 'file:///tmp/index.json' }, { indexUrl: 'https://github.com.evil.test/index.json' }, { indexSha256: 'bad' }]) assert.throws(() => validateChannel({ ...f.channel, ...changes }));
  await assert.rejects(fetchIndex(f.channel, async () => new Response('{}')), /checksum/);
  await assert.rejects(fetchIndex(f.channel, async () => new Response('x'.repeat(262145))), /too-large/);
  const altered = JSON.parse(f.body); altered.packs[0].parts[0].url = 'file:///private';
  const body = JSON.stringify(altered);
  await assert.rejects(fetchIndex({ ...f.channel, indexSha256: hash(body) }, async () => new Response(body)), /untrusted-update-part/);
});
test('unchanged voice identity never downloads index or model', async t => {
  const f = await fixture(t);
  const result = await updateVoice(f.config, { ...f.channel, sha256: f.previous.sha256 }, { ...f.options, fetchImpl: () => { throw new Error('unexpected download'); } });
  assert.deepEqual(result, { changed: false, downloaded: false }); assert.deepEqual(f.calls, []);
});
test('runtime downgrade and replacement of an immutable version never downloads', async t => {
  const f = await fixture(t), options = { ...f.options, fetchImpl: () => { throw new Error('unexpected download'); } };
  assert.equal((await updateVoice(f.config, { ...f.channel, version: '0.9.0' }, options)).skipped, 'older-release');
  await assert.rejects(updateVoice(f.config, { ...f.channel, version: f.previous.version }, options), /immutable/);
});
test('service starting during download defers activation and leaves old pointer', async t => {
  const f = await fixture(t); let checks = 0;
  assert.equal((await updateVoice(f.config, f.channel, { ...f.options, busy: async () => ++checks > 1 })).deferred, true);
  assert.deepEqual(f.calls, ['prepare']);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.config.root, 'active-pack.json'))), f.previous);
});
test('busy ST/voice defers update without network or file writes', async t => {
  const f = await fixture(t);
  const result = await autoUpdate(f.config, { busy: async () => true, extensionUpdater: () => { throw new Error('must not update'); }, log: () => {} });
  assert.equal(result.deferred, true); assert.deepEqual(f.calls, []);
});
test('offline update leaves old active pack and player files intact', async t => {
  const f = await fixture(t);
  await assert.rejects(updateVoice(f.config, f.channel, { ...f.options, fetchImpl: async () => { throw new Error('offline'); } }), /offline/);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.config.root, 'active-pack.json'))), f.previous);
  assert.equal(await fs.readFile(path.join(f.config.root, 'profiles/mine.npz'), 'utf8'), 'my voice');
});
test('candidate health failure stops only candidate and restores previous pointer', async t => {
  const f = await fixture(t);
  await assert.rejects(updateVoice(f.config, f.channel, { ...f.options, services: async (c, a, action) => { f.calls.push(`${action}:${a.version}`); if (action === 'start') throw new Error('health failed'); } }), /health failed/);
  assert.deepEqual(f.calls, ['prepare', 'start:1.0.0-beta.2', 'stop:1.0.0-beta.2']);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.config.root, 'active-pack.json'))), f.previous);
  assert.equal(await fs.readFile(path.join(f.config.root, 'history.json'), 'utf8'), 'my history');
  await assert.rejects(fs.stat(path.join(f.config.root, 'pending-update.json')), /ENOENT/);
});
test('healthy candidate activates only after health; preserves user voice and history', async t => {
  const f = await fixture(t);
  const result = await updateVoice(f.config, f.channel, { ...f.options, services: async () => assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.config.root, 'active-pack.json'))), f.previous) });
  assert.equal(result.changed, true);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.config.root, 'active-pack.json'))), f.candidate);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.config.root, 'previous-pack.json'))), f.previous);
  assert.equal(await fs.readFile(path.join(f.config.root, 'profiles/mine.npz'), 'utf8'), 'my voice');
  assert.equal(await fs.readFile(path.join(f.config.root, 'history.json'), 'utf8'), 'my history');
});
test('interrupted activation recovers before new update; active ST blocks recovery', async t => {
  const f = await fixture(t); const file = path.join(f.config.root, 'pending-update.json');
  await fs.writeFile(file, JSON.stringify({ previous: f.previous, candidate: f.candidate }));
  await fs.writeFile(path.join(f.config.root, 'active-pack.json'), JSON.stringify(f.candidate));
  await assert.rejects(recoverPending(f.config, { services: f.options.services, busy: async () => true }), /deferred/);
  assert.equal(f.calls.length, 0);
  assert.equal(await recoverPending(f.config, { services: f.options.services, busy: idle }), true);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.config.root, 'active-pack.json'))), f.previous);
});
test('updates-off does not contact GitHub', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.config.root, 'update-settings.json'), '{"enabled":false}');
  assert.deepEqual(await autoUpdate(f.config, { extensionUpdater: () => { throw new Error('unexpected'); } }), { disabled: true });
});
test('launcher engine changes atomically and repeated install reuses identical code', async t => {
  const f = await fixture(t), source = path.join(f.directory, 'source'); await fs.mkdir(source);
  for (const name of engineFiles) await fs.writeFile(path.join(source, name), '// version one');
  const first = await installLauncher(f.config, source);
  assert.equal(await installLauncher(f.config, source), first);
  await fs.writeFile(path.join(source, 'start.mjs'), '// version two');
  const second = await installLauncher(f.config, source); assert.notEqual(second, first);
  assert.equal(await fs.readFile(path.join(f.config.root, 'launcher/engines', first, 'start.mjs'), 'utf8'), '// version one');
  assert.equal(JSON.parse(await fs.readFile(path.join(f.config.root, 'launcher/engine.json'))).id, second);
  await fs.unlink(path.join(source, 'start.mjs'));
  await assert.rejects(installLauncher(f.config, source), /ENOENT/);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.config.root, 'launcher/engine.json'))).id, second);
});
async function gitFixture(t) {
  const f = await fixture(t), remote = path.join(f.directory, 'remote'); await fs.mkdir(remote);
  const git = (...args) => run('git', ['-C', remote, ...args]);
  await git('init', '-b', 'main'); await git('config', 'user.name', 'Test'); await git('config', 'user.email', 'test@example.invalid');
  await fs.mkdir(path.join(remote, 'scripts')); await fs.writeFile(path.join(remote, 'scripts/verify-release.mjs'), "import fs from 'node:fs'; if (fs.readFileSync('payload.txt','utf8') !== 'good') throw Error('bad payload');\n");
  await fs.writeFile(path.join(remote, 'payload.txt'), 'good'); await git('add', '.'); await git('commit', '-m', 'baseline');
  const target = extensionPath(f.config); await fs.mkdir(path.dirname(target), { recursive: true });
  await run('git', ['clone', remote, target]); await run('git', ['-C', target, 'remote', 'set-url', 'origin', REPOSITORY]);
  const old = (await git('rev-parse', 'HEAD')).trim();
  const execute = (command, args, options) => run(command, command === 'git' ? args.map(a => (args.includes('fetch') && a === 'origin') || a === `${REPOSITORY}.git` ? remote : a) : args, options);
  return { ...f, git, remote, target, old, execute };
}
test('extension fast-forwards verified release and records previous ref', async t => {
  const f = await gitFixture(t);
  await fs.writeFile(path.join(f.remote, 'new.txt'), 'release'); await f.git('add', '.'); await f.git('commit', '-m', 'new');
  const result = await updateExtension(f.config, { execute: f.execute, busy: idle });
  assert.equal(result.changed, true); assert.equal(result.before, f.old);
  assert.equal((await run('git', ['-C', f.target, 'rev-parse', 'refs/tmrw/previous'])).trim(), f.old);
  assert.equal(await fs.readFile(path.join(f.target, 'new.txt'), 'utf8'), 'release');
});
test('invalid extension candidate and modified checkout are never overwritten', async t => {
  const f = await gitFixture(t);
  await fs.writeFile(path.join(f.remote, 'payload.txt'), 'broken'); await f.git('add', '.'); await f.git('commit', '-m', 'bad');
  await assert.rejects(updateExtension(f.config, { execute: f.execute, busy: idle }), /bad payload/);
  assert.equal((await run('git', ['-C', f.target, 'rev-parse', 'HEAD'])).trim(), f.old);
  await fs.writeFile(path.join(f.target, 'mine.txt'), 'custom');
  await assert.rejects(updateExtension(f.config, { execute: f.execute, busy: idle }), /modified/);
  assert.equal(await fs.readFile(path.join(f.target, 'mine.txt'), 'utf8'), 'custom');
});
test('extension is not changed if a service starts during candidate verification', async t => {
  const f = await gitFixture(t);
  await fs.writeFile(path.join(f.remote, 'new.txt'), 'release'); await f.git('add', '.'); await f.git('commit', '-m', 'new');
  await assert.rejects(updateExtension(f.config, { execute: f.execute, busy: async () => true }), /services-started/);
  assert.equal((await run('git', ['-C', f.target, 'rev-parse', 'HEAD'])).trim(), f.old);
});
