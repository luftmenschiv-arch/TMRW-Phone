import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { sha256 } from '../../installers/android/download.mjs';
const [partsArg, releaseArg, mode] = process.argv.slice(2);
if (!partsArg || !releaseArg) throw new Error('Pass parts directory and release assets directory');
const files = [];
for (const name of (await fs.readdir(partsArg)).filter(n => /^runtime\.part-\d{5}$/u.test(n))) files.push(path.join(partsArg, name));
for (const name of ['install.sh', 'installer.tar.gz', 'install-index.json', 'tmrw-phone-0.1.0-beta.3.zip']) files.push(path.join(releaseArg, name));
const expected = [];
for (const file of files) expected.push({ name: path.basename(file), size: (await fs.stat(file)).size, sha256: await sha256(file) });
if (mode === '--write-sums') {
  await fs.writeFile(path.join(releaseArg, 'SHA256SUMS.txt'), expected.map(f => `${f.sha256}  ${f.name}`).join('\n') + '\n');
  console.log(`Wrote ${expected.length} asset checksums`);
} else {
  const sums = path.join(releaseArg, 'SHA256SUMS.txt');
  expected.push({ name: 'SHA256SUMS.txt', size: (await fs.stat(sums)).size, sha256: await sha256(sums) });
  const releases = JSON.parse(execFileSync('gh', ['api', 'repos/luftmenschiv-arch/SillyTavern-Extension-TMRW-Phone/releases?per_page=10'], { encoding: 'utf8', maxBuffer: 4 * 1024 ** 2 }));
  const release = releases.find(r => r.tag_name === 'v0.1.0-beta.3');
  if (!release || release.assets.length !== expected.length) throw new Error('release-assets-missing-or-unexpected');
  for (const file of expected) {
    const a = release.assets.find(a => a.name === file.name);
    if (!a || a.size !== file.size || a.digest !== `sha256:${file.sha256}`) throw new Error(`remote-checksum:${file.name}`);
  }
  const report = { tag: release.tag_name, draft: release.draft, assets: expected.length, allRemoteDigestsMatch: true, checkedAt: new Date().toISOString() };
  await fs.writeFile(path.join(releaseArg, 'remote-assets-audit.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
