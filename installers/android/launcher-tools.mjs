import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
export const engineFiles = ['start.mjs', 'auto-update.mjs', 'download.mjs', 'install-runtime.mjs', 'launcher-tools.mjs'];
// Version the small updater itself; never leave a mixture of old/new source files.
export async function installLauncher(config, source) {
  const launcher = path.join(config.root, 'launcher');
  await fs.mkdir(path.join(launcher, 'engines'), { recursive: true });
  for (const folder of [launcher, path.join(launcher, 'engines')]) if ((await fs.lstat(folder)).isSymbolicLink()) throw new Error('unsafe-launcher-directory');
  const files = new Map();
  for (const file of engineFiles) files.set(file, await fs.readFile(path.join(source, file)));
  files.set('config.json', Buffer.from(JSON.stringify(config)));
  const hash = crypto.createHash('sha256'); for (const [name, data] of files) hash.update(name).update(data);
  const id = hash.digest('hex'), target = path.join(launcher, 'engines', id);
  if (!await fs.stat(target).catch(() => null)) {
    const stage = path.join(launcher, 'engines', `stage-${crypto.randomUUID()}`); await fs.mkdir(stage);
    for (const [name, data] of files) await fs.writeFile(path.join(stage, name), data, { flag: 'wx' });
    await fs.rename(stage, target);
  }
  if ((await fs.lstat(target)).isSymbolicLink()) throw new Error('unsafe-launcher-engine');
  for (const [name, data] of files) if (!(await fs.readFile(path.join(target, name))).equals(data)) throw new Error('launcher-engine-checksum');
  const temp = path.join(launcher, `engine-${crypto.randomUUID()}.tmp`);
  await fs.writeFile(temp, JSON.stringify({ id }), { flag: 'wx' });
  await fs.rename(temp, path.join(launcher, 'engine.json'));
  return id;
}
