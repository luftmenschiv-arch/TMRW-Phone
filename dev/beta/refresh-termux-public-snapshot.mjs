import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repo = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Pass existing reviewed public checkout');
const origin = execFileSync('git', ['-C', repo, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
if (origin.replace(/\.git$/u, '') !== 'https://github.com/luftmenschiv-arch/SillyTavern-Extension-TMRW-Phone') throw new Error('not-public-player-repo');
const dest = path.join(repo, 'scripts/termux'); await fs.mkdir(dest, { recursive: true });
for (const file of ['download.mjs', 'install-runtime.mjs', 'setup.mjs', 'start.mjs', 'install.sh', 'auto-update.mjs', 'launch.mjs', 'launcher-tools.mjs', 'voice-update.json']) await fs.writeFile(path.join(dest, file), (await fs.readFile(path.join(source, 'installers/android', file), 'utf8')).replace(/\r\n/gu, '\n'));
const release = JSON.parse(await fs.readFile(path.join(repo, 'release.json'), 'utf8'));
release.version = '0.1.0-beta.4'; release.components.extension = release.version;
release.components.voicePack = '1.0.0-beta.1'; release.components.termuxInstaller = '1.0.0-beta.2';
release.compatibility.focusedTestsPassed = 78;
release.pending = ['fresh-android-termux-installation-matrix', 'live-provider-qualification'];
release.termux = { channel: 'beta', platform: 'standard-Termux-Android-arm64', releaseTag: 'v0.1.0-beta.4', runtimePack: '1.0.0-beta.1', installIndexSchema: 'tmrw-termux-install-v1', updateProtocol: 1, tested: 'isolated-root-on-Realme-RMX3370-Android-13', notTested: ['fresh-OS-package-manager-bootstrap', 'all-Android-models', 'live-provider-503-recovery'], dataPreservation: 'repeat-install-31-profile-files-history-and-active-pointer-byte-identical', presetPermission: 'owner-confirmed-public-distribution-2026-09-28' };
for (const name of ['manifest.json', 'package.json']) {
  const value = JSON.parse(await fs.readFile(path.join(repo, name), 'utf8'));
  value.version = release.version;
  if (name === 'manifest.json') value.auto_update = true;
  await fs.writeFile(path.join(repo, name), JSON.stringify(value, null, 2) + '\n');
}
delete release.companion; // beta.2 companion remains in that immutable old release.
const files = [];
async function walk(dir, prefix = '') {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (e.name === '.git') continue;
    const rel = prefix ? `${prefix}/${e.name}` : e.name, file = path.join(dir, e.name);
    if (e.isSymbolicLink()) throw new Error('public-symlink');
    if (e.isDirectory()) { await walk(file, rel); continue; }
    if (rel === 'release.json') continue;
    let bytes = await fs.readFile(file);
    if (/\.(?:md|mjs|js|css|json|sh)$/u.test(rel)) {
      const text = bytes.toString('utf8').replace(/\r\n/gu, '\n');
      if (/(?:AIza[\w-]{30,}|ghp_[\w]{25,}|github_pat_[\w]{25,}|sk-or-v1-[\da-f]{32,})|C:[\\/]Users[\\/]lolit[\\/]|192\.168\.100\.125/u.test(text)) throw new Error(`private-value:${rel}`);
      bytes = Buffer.from(text); await fs.writeFile(file, bytes);
    }
    files.push({ path: rel, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
  }
}
await walk(repo); release.files = files.sort((a, b) => a.path.localeCompare(b.path));
await fs.writeFile(path.join(repo, 'release.json'), JSON.stringify(release, null, 2) + '\n');
execFileSync(process.execPath, [path.join(repo, 'scripts/verify-release.mjs')], { stdio: 'inherit' });
