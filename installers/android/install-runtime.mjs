import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { constants } from 'node:fs';
import { downloadPack, extractPack, verifyPayload, checkedPack, acquireLock } from './download.mjs';

export async function installRuntime({ index, id, root, preflight = async () => {}, onProgress, downloadOptions = {} }) {
  root = path.resolve(root);
  const pack = checkedPack(index, id);
  if (root === path.parse(root).root) throw new Error('unsafe-install-root');
  await fs.mkdir(root, { recursive: true });
  if ((await fs.lstat(root)).isSymbolicLink()) throw new Error('symlink-install-root');
  const unlock = await acquireLock(path.join(root, 'install.lock'));
  try {
  for (const name of ['packs', '.staging', 'profiles', 'downloads']) {
    const dir = path.join(root, name); await fs.mkdir(dir, { recursive: true });
    if ((await fs.lstat(dir)).isSymbolicLink()) throw new Error('symlink-install-subdirectory');
  }
  const target = path.join(root, 'packs', `${pack.id}-${pack.version}-${pack.sha256.slice(0, 12)}`);
  const activeFile = path.join(root, 'active-pack.json');
  const prior = JSON.parse(await fs.readFile(activeFile, 'utf8').catch(() => '{}'));
  if (prior.sha256 === pack.sha256 && prior.target === target) {
    await verifyPayload(target); await preflight(target); return { target, reused: true };
  }
  const existing = await fs.lstat(target).catch(() => null);
  if (existing) {
    if (!existing.isDirectory() || existing.isSymbolicLink()) throw new Error('unsafe-pack-target');
    // A prior interrupted attempt may have completed extraction but not activation.
    await verifyPayload(target);
  } else {
    const { archive } = await downloadPack({ ...downloadOptions, index, id, cache: path.join(root, 'downloads'), onProgress });
    const stage = path.join(root, '.staging', crypto.randomUUID());
    const payload = await extractPack({ archive, pack, directory: stage });
    await verifyPayload(payload);
    await fs.rename(payload, target);
    await fs.rmdir(stage); // Exactly the empty staging directory created above.
  }
  try { await preflight(target); } catch (error) {
    // Keep failed payload for diagnostics; never activate it or overwrite a prior install.
    throw new Error(`runtime-preflight-failed:${error.message}`);
  }
  const bundled = path.join(target, 'profiles');
  for (const entry of await fs.readdir(bundled, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^(?:male|female)-[a-z-]+$|^tmrw-(?:male|female)-core$/u.test(entry.name)) throw new Error('unexpected-bundled-profile');
    const destination = path.join(root, 'profiles', entry.name);
    await fs.mkdir(destination, { recursive: true });
    if ((await fs.lstat(destination)).isSymbolicLink()) throw new Error('symlink-profile');
    await fs.copyFile(path.join(bundled, entry.name, 'voice.voiceprofile.npz'), path.join(destination, 'voice.voiceprofile.npz'), constants.COPYFILE_EXCL).catch(e => { if (e.code !== 'EEXIST') throw e; });
  }
  const temp = path.join(root, `active-pack-${crypto.randomUUID()}.tmp`);
  await fs.writeFile(temp, `${JSON.stringify({ id: pack.id, version: pack.version, sha256: pack.sha256, target }, null, 2)}\n`, { flag: 'wx' });
  await fs.rename(temp, activeFile);
  return { target, reused: false };
  } finally { await unlock(); }
}
