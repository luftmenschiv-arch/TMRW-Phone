import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { checkedPack, downloadPack, ensureSpace, validateTarListing, extractPack, verifyPayload, run, acquireLock } from '../../installers/android/download.mjs';
import { installRuntime } from '../../installers/android/install-runtime.mjs';
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const noSpaceCheck = async () => {};
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tmrw-termux-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const blocks = [Buffer.from('first-verified-block'), Buffer.from('second-verified-block')];
  const all = Buffer.concat(blocks);
  const index = { schema: 'tmrw-termux-install-v1', baseUrl: 'https://example.test/', packs: [{ id: 'android-arm64', version: '1.0.0-beta.1', rootDirectory: 'android-arm64', size: all.length, unpackedBytes: 1000, sha256: hash(all), parts: blocks.map((b, i) => ({ index: i, url: `part-${i}`, size: b.length, sha256: hash(b) })) }] };
  return { root, blocks, index, all, cache: path.join(root, 'cache') };
}
test('download validates manifest identities, sizes, and secure URLs', async t => {
  const f = await fixture(t); assert.equal(checkedPack(f.index, 'android-arm64').parts.length, 2);
  for (const mutate of [p => p.id = '../escape', p => p.version = '../../x', p => p.rootDirectory = '/tmp', p => p.parts[0].index = 2, p => p.size++, p => p.parts[0].url = 'http://evil.test/file', p => p.parts[0].url = 'https://user:pass@host/file']) {
    const i = structuredClone(f.index); mutate(i.packs[0]); assert.throws(() => checkedPack(i, i.packs[0].id));
  }
});
test('completed parts survive interruption; rerun downloads only missing parts', async t => {
  const f = await fixture(t); const calls = [];
  const fetchImpl = async u => { const n = Number(u.pathname.at(-1)); calls.push(n); if (n === 1) throw new Error('offline'); return new Response(f.blocks[n]); };
  await assert.rejects(downloadPack({ ...f, id: 'android-arm64', fetchImpl, attempts: 1, spaceCheck: noSpaceCheck }), /offline/);
  calls.length = 0;
  const result = await downloadPack({ ...f, id: 'android-arm64', fetchImpl: async u => { const n = Number(u.pathname.at(-1)); calls.push(n); return new Response(f.blocks[n]); }, spaceCheck: noSpaceCheck });
  assert.deepEqual(calls, [1]); assert.deepEqual(await fs.readFile(result.archive), f.all);
  const again = await downloadPack({ ...f, id: 'android-arm64', fetchImpl: () => { throw new Error('must not redownload'); }, spaceCheck: noSpaceCheck });
  assert.equal(again.reused, true);
});
test('corrupt or oversized downloads never become accepted cache files', async t => {
  const f = await fixture(t);
  await assert.rejects(downloadPack({ ...f, id: 'android-arm64', fetchImpl: async () => new Response('bad'), attempts: 1, spaceCheck: noSpaceCheck }), /checksum/);
  await assert.rejects(downloadPack({ ...f, id: 'android-arm64', fetchImpl: async () => new Response(Buffer.alloc(1000)), attempts: 1, spaceCheck: noSpaceCheck }), /too-large/);
  const files = await fs.readdir(path.join(f.cache, f.index.packs[0].sha256)); assert.deepEqual(files, []);
});
test('cancellation stops requests and frees the download lock', async t => {
  const f = await fixture(t), controller = new AbortController(); let calls = 0;
  await assert.rejects(downloadPack({ ...f, id: 'android-arm64', signal: controller.signal, fetchImpl: async u => { calls++; return new Response(f.blocks[Number(u.pathname.at(-1))]); }, onProgress: () => controller.abort(), spaceCheck: noSpaceCheck }), /abort/i);
  assert.equal(calls, 1);
  assert.equal((await fs.readdir(path.join(f.cache, f.index.packs[0].sha256))).some(f => f.endsWith('.lock')), false);
});
test('disk-space check stops before network access', async t => {
  await assert.rejects(ensureSpace('.', 200, async () => ({ bavail: 1, bsize: 100 })), /not-enough-space/);
  const f = await fixture(t); let calls = 0;
  await assert.rejects(downloadPack({ ...f, id: 'android-arm64', fetchImpl: () => calls++, spaceCheck: () => { throw new Error('disk-full'); } }), /disk-full/);
  assert.equal(calls, 0);
});
test('archive traversal, symlinks, hardlinks and special files are rejected', () => {
  validateTarListing('pack/\npack/a\n', 'drwx pack\n-rwx pack/a\n', 'pack');
  for (const name of ['../escape', '/absolute', 'pack/../escape', 'other/a', 'pack/C:foo', 'pack/a\\b']) assert.throws(() => validateTarListing(name, '-rw file', 'pack'));
  for (const type of ['l', 'h', 'p', 'c', 'b']) assert.throws(() => validateTarListing('pack/a', `${type}rwx file`, 'pack'));
});
test('real tar extraction, payload integrity, install repeat and clone preservation', async t => {
  const f = await fixture(t); const payload = path.join(f.root, 'build', 'android-arm64');
  await fs.mkdir(path.join(payload, 'profiles', 'male-soft-youth'), { recursive: true });
  const data = Buffer.from('bundled-voice'); const rel = 'profiles/male-soft-youth/voice.voiceprofile.npz';
  await fs.writeFile(path.join(payload, rel), data);
  await fs.writeFile(path.join(payload, 'payload.json'), JSON.stringify({ schema: 'tmrw-runtime-payload-v1', files: [{ path: rel, bytes: data.length, sha256: hash(data) }] }));
  const archive = path.join(f.root, 'voice.tar.gz'); await run('tar', ['-czf', archive, '-C', path.dirname(payload), 'android-arm64']);
  const bytes = await fs.readFile(archive);
  const index = { schema: 'tmrw-termux-install-v1', baseUrl: pathToFileURL(f.root + path.sep).href, packs: [{ id: 'android-arm64', version: '1.0.0-beta.1', rootDirectory: 'android-arm64', size: bytes.length, unpackedBytes: 1000, sha256: hash(bytes), parts: [{ index: 0, url: 'voice.tar.gz', size: bytes.length, sha256: hash(bytes) }] }] };
  const root = path.join(f.root, 'user'); await fs.mkdir(path.join(root, 'profiles', 'male-soft-youth'), { recursive: true });
  const userFile = path.join(root, 'profiles', 'male-soft-youth', 'voice.voiceprofile.npz'); await fs.writeFile(userFile, 'user-clone-do-not-overwrite');
  await fs.writeFile(path.join(root, 'history.json'), 'keep-history');
  const installed = await installRuntime({ index, id: 'android-arm64', root, downloadOptions: { spaceCheck: noSpaceCheck } });
  assert.equal(await fs.readFile(userFile, 'utf8'), 'user-clone-do-not-overwrite');
  assert.equal(await fs.readFile(path.join(root, 'history.json'), 'utf8'), 'keep-history');
  assert.equal((await installRuntime({ index, id: 'android-arm64', root, downloadOptions: { spaceCheck: noSpaceCheck } })).reused, true);
  assert.equal(JSON.parse(await fs.readFile(path.join(root, 'active-pack.json'))).target, installed.target);
  await fs.writeFile(path.join(installed.target, rel), 'bad');
  await assert.rejects(verifyPayload(installed.target), /checksum/);
  const untouched = path.join(f.root, 'failed-user'); await fs.mkdir(untouched); await fs.writeFile(path.join(untouched, 'active-pack.json'), '{"target":"prior"}');
  await assert.rejects(installRuntime({ index, id: 'android-arm64', root: untouched, preflight: () => { throw new Error('missing-dependency'); }, downloadOptions: { spaceCheck: noSpaceCheck } }), /preflight/);
  assert.equal(JSON.parse(await fs.readFile(path.join(untouched, 'active-pack.json'))).target, 'prior');
  const recovered = await installRuntime({ index, id: 'android-arm64', root: untouched, downloadOptions: { fetchImpl: () => { throw new Error('must-use-verified-inactive-pack'); }, spaceCheck: noSpaceCheck } });
  assert.equal(JSON.parse(await fs.readFile(path.join(untouched, 'active-pack.json'))).target, recovered.target);
});

test('install locking prevents concurrent activation and recovers an interrupted process', async t => {
  const f = await fixture(t), file = path.join(f.root, 'install.lock');
  const unlock = await acquireLock(file);
  await assert.rejects(acquireLock(file), /locked/); await unlock();
  await fs.writeFile(file, JSON.stringify({ pid: 2147483647 }));
  const recovered = await acquireLock(file); await recovered();
  await fs.writeFile(file, 'incomplete'); await assert.rejects(acquireLock(file), /locked/);
});
