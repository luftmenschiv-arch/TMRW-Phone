// Only the previously-created isolated QA installation. Never the owner's ST.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const base = '/data/data/com.termux/files/home/.tmrw-public-install-qa-20260928';
const source = '/data/local/tmp/tmrw-step5';
const { updateExtension, autoUpdate, updateVoice, recoverPending, service, extensionPath } = await import(`${source}/auto-update.mjs`);
const { installLauncher } = await import(`${source}/launcher-tools.mjs`);
const { run } = await import(`${source}/download.mjs`);
const config = { root: `${base}/voice`, st: `${base}/ST`, runtimePort: 18779, managerPort: 18778 };
process.env.TMRW_ST_URL = 'http://127.0.0.1:18800'; // not the real ST server
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
async function profiles(dir) {
  const result = {};
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) for (const [p, sha] of Object.entries(await profiles(path.join(dir, e.name)))) result[`${e.name}/${p}`] = sha;
    else result[e.name] = hash(await fs.readFile(path.join(dir, e.name)));
  }
  return result;
}
const before = await profiles(`${config.root}/profiles`);
const history = await fs.readFile(`${config.root}/history.json`, 'utf8');
const original = JSON.parse(await fs.readFile(`${config.root}/active-pack.json`, 'utf8'));
await service(config, original, 'stop');
// Same public origin; candidate branch is checked before promoting main.
const extension = await updateExtension(config, { execute: (cmd, args, opts) => run(cmd,
  cmd === 'git' && args.includes('fetch') ? args.map(a => a === 'main' ? 'release/auto-update-beta-4' : a) : args, opts) });
const engine = await installLauncher(config, path.join(extensionPath(config), 'scripts/termux'));
await fs.copyFile(path.join(extensionPath(config), 'scripts/termux/launch.mjs'), `${config.root}/launcher/start.mjs`);
const unchanged = await autoUpdate(config, { extensionUpdater: async () => ({ changed: false }) });
assert.equal(unchanged.voice.downloaded, false);
assert.deepEqual(JSON.parse(await fs.readFile(`${config.root}/active-pack.json`, 'utf8')), original);
// Exercise real process failure/cleanup on an explicit disposable fake candidate.
const candidate = { ...original, version: '1.0.0-beta.2', sha256: 'b'.repeat(64), target: `${config.root}/packs/step5-failing-test-candidate` };
await fs.mkdir(`${candidate.target}/bin`, { recursive: true });
await fs.writeFile(`${candidate.target}/bin/START-TMRW-VOICE-SERVICES.sh`, '#!/data/data/com.termux/files/usr/bin/bash\nexit 44\n');
await fs.writeFile(`${candidate.target}/bin/STOP-TMRW-VOICE-SERVICES.sh`, '#!/data/data/com.termux/files/usr/bin/bash\nexit 0\n');
const index = { schema: 'tmrw-termux-install-v1', baseUrl: 'https://github.com/luftmenschiv-arch/SillyTavern-Extension-TMRW-Phone/releases/download/v0.1.0-beta.4/', qualification: { publishApproved: true }, packs: [{ ...candidate, rootDirectory: 'android-arm64', size: 1, unpackedBytes: 1, parts: [{ index: 0, url: 'fixture-only', sha256: 'c'.repeat(64), size: 1 }] }] };
const body = JSON.stringify(index);
const channel = { schema: 'tmrw-voice-update-v1', protocol: 1, id: candidate.id, version: candidate.version, sha256: candidate.sha256, indexUrl: `${index.baseUrl}install-index.json`, indexSha256: hash(body) };
await assert.rejects(updateVoice(config, channel, { fetchImpl: async () => new Response(body), install: async () => ({ target: candidate.target, activation: candidate }) }), /failed \(44\)/);
assert.deepEqual(JSON.parse(await fs.readFile(`${config.root}/active-pack.json`, 'utf8')), original);
await fs.writeFile(`${config.root}/pending-update.json`, JSON.stringify({ previous: original, candidate }));
await fs.writeFile(`${config.root}/active-pack.json`, JSON.stringify(candidate));
assert.equal(await recoverPending(config), true);
assert.deepEqual(JSON.parse(await fs.readFile(`${config.root}/active-pack.json`, 'utf8')), original);
console.log(await run('bash', [`${base}/bin/tmrw-start`, '--voice-only'], { env: { ...process.env, TMRW_NO_UPDATE: '1' } }));
const busy = await autoUpdate(config); assert.equal(busy.deferred, true);
for (const [port, route] of [[18778, '/v1/health'], [18779, '/health']]) {
  assert.equal((await (await fetch(`http://127.0.0.1:${port}${route}`)).json()).ready, true);
}
assert.deepEqual(await profiles(`${config.root}/profiles`), before);
assert.equal(await fs.readFile(`${config.root}/history.json`, 'utf8'), history);
console.log(await run('bash', [`${base}/bin/tmrw-start`, '--updates-off']));
console.log(await run('bash', [`${base}/bin/tmrw-start`, '--updates-on']));
console.log(await run('bash', [`${base}/bin/tmrw-start`, '--stop-voice']));
const report = { checkedAt: new Date().toISOString(), extension, engine, unchangedPackNoDownload: true, failedCandidateRollback: true, interruptedRecovery: true, launcherStartsBothServices: true, busyDeferred: true, profileFilesPreserved: Object.keys(before).length, historyPreserved: true, updateToggle: true, limits: 'Candidate extension fetched from public preparation branch before promotion. Runtime failure candidate and metadata are synthetic; approved model unchanged.' };
await fs.writeFile(`${base}/step5-qualification.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
