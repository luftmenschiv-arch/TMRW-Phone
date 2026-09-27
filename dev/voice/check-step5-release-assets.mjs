import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
const directory = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Pass release asset directory');
const names = ['install.sh', 'installer.tar.gz', 'install-index.json', 'tmrw-phone-0.1.0-beta.4.zip'];
const entries = [];
for (const name of names) { const bytes = await fs.readFile(path.join(directory, name)); entries.push({ name, size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }); }
if (process.argv.includes('--write-sums')) {
  await fs.writeFile(path.join(directory, 'SHA256SUMS.txt'), entries.map(e => `${e.sha256}  ${e.name}`).join('\n') + '\n', { flag: 'wx' });
} else {
  const sums = await fs.readFile(path.join(directory, 'SHA256SUMS.txt'));
  entries.push({ name: 'SHA256SUMS.txt', size: sums.length, sha256: crypto.createHash('sha256').update(sums).digest('hex') });
  const releases = JSON.parse(execFileSync('gh', ['api', 'repos/luftmenschiv-arch/SillyTavern-Extension-TMRW-Phone/releases?per_page=20'], { encoding: 'utf8' }));
  const release = releases.find(r => r.tag_name === 'v0.1.0-beta.4');
  if (release?.assets.length !== entries.length) throw new Error('release-assets-incomplete');
  for (const entry of entries) { const remote = release.assets.find(a => a.name === entry.name); if (remote?.size !== entry.size || remote.digest !== `sha256:${entry.sha256}`) throw new Error(`remote-asset-mismatch:${entry.name}`); }
  const report = { tag: release.tag_name, draft: release.draft, allRemoteDigestsMatch: true, assets: entries, checkedAt: new Date().toISOString() };
  await fs.writeFile(path.join(directory, 'remote-assets-audit.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
