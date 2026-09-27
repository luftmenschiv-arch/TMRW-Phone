// Android-only fixture, never the owner's working ST/voice installation.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const root = '/data/data/com.termux/files/home/.tmrw-full-install-qa-20260928';
const { setup } = await import(`${root}/installer/setup.mjs`);
const { run } = await import(`${root}/installer/download.mjs`);
const voice = `${root}/voice`;
async function profileHashes(dir, prefix = '') {
  const out = {};
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, e.name), rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) Object.assign(out, await profileHashes(file, rel));
    else out[rel] = crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
  }
  return out;
}
const before = await profileHashes(`${voice}/profiles`);
const history = await fs.readFile(`${voice}/history.json`, 'utf8');
const active = await fs.readFile(`${voice}/active-pack.json`, 'utf8');
const result = await setup({ indexFile: '/data/local/tmp/tmrw-install-index.json', indexHash: '623bec227f32ee5e0fc5e023b62bab556d6b07d5dcf2c15b0b12565eb37a358f', st: `${root}/ST`, root: voice, launcherDirectory: `${root}/bin`, noStart: true });
const after = await profileHashes(`${voice}/profiles`);
if (!result.reused || JSON.stringify(before) !== JSON.stringify(after) || history !== await fs.readFile(`${voice}/history.json`, 'utf8') || active !== await fs.readFile(`${voice}/active-pack.json`, 'utf8')) throw new Error('repeat-install-preservation-failed');
console.log(await run('bash', [`${root}/bin/tmrw-start`, '--stop-voice']));
for (const port of [18778, 18779]) {
  let listening = false; try { await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) }); listening = true; } catch {}
  if (listening) throw new Error('qa-service-still-running');
}
console.log(await run('bash', [`${root}/bin/tmrw-start`, '--voice-only']));
const report = { repeated: true, reused: true, profileFilesPreserved: Object.keys(before).length, historyPreserved: true, activePointerUnchanged: true, launcherStopAndStart: true };
await fs.writeFile(`${root}/repeat-qualification.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
