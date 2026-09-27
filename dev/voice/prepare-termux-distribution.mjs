// Run on the already qualified staging copy only, never the working runtime.
import fs from 'node:fs/promises';
import path from 'node:path';
const home = '/data/data/com.termux/files/home', prefix = '/data/data/com.termux/files/usr';
const stage = `${home}/.tmrw-distribution-stage-20260928`;
const quarantine = `${home}/.tmrw-optional-python-modules-20260928`;
if (await fs.stat(quarantine).catch(() => null)) throw new Error('already-prepared');
await fs.mkdir(quarantine);
// These optional interactive/dbm modules are not used by the voice runtime.
// Keep them outside the distributed pack rather than bundle unused GPL binaries.
const moved = ['lib/libreadline.so.8', 'lib/libgdbm.so', 'lib/libgdbm_compat.so',
  ...['_dbm', '_gdbm', 'readline'].map(n => `python/lib/python3.13/lib-dynload/${n}.cpython-313-aarch64-linux-android.so`)];
for (const rel of moved) {
  const from = path.join(stage, rel), to = path.join(quarantine, rel);
  if (!from.startsWith(stage + '/') || !to.startsWith(quarantine + '/')) throw new Error('unsafe-stage-move');
  await fs.mkdir(path.dirname(to), { recursive: true }); await fs.rename(from, to);
}
const names = ['libandroid-posix-semaphore', 'libandroid-support', 'libbz2', 'libc++', 'openssl', 'libexpat', 'libffi', 'liblzma', 'ncurses', 'libsqlite', 'zlib'];
for (const name of names) await fs.cp(`${prefix}/share/doc/${name}`, `${stage}/notices/termux/${name}`, { recursive: true, dereference: true });
await fs.cp(`${home}/soxr-040-android/soxr-0.4.0`, `${stage}/sources/python-soxr-0.4.0`, { recursive: true, dereference: true,
  filter: file => !file.split('/').some(s => ['build', '.git', '__pycache__', '.pytest_cache'].includes(s)) && !/\.(?:so|pyc|o|a)$/u.test(file),
});
await fs.writeFile(`${stage}/notices/packaging-changes.json`, JSON.stringify({ optionalPythonModulesNotDistributed: moved, reason: 'Not required for speech; avoids redistributing unused readline/gdbm native modules.', pythonGlobalInstallationChanged: false, soxrSources: 'sources/python-soxr-0.4.0', presetReferences: 'Project owner confirmed public distribution permission on 2026-09-28.' }, null, 2) + '\n');
console.log(JSON.stringify({ stage, preservedOptionalFiles: quarantine, moved: moved.length, termuxNotices: names.length }));
