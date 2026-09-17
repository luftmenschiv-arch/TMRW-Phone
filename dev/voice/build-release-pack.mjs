import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { patchMobileRuntime } from './patch-mobile-runtime.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(value => value.split(/=(.*)/s).slice(0, 2)));
const source = path.resolve(args['--source'] || '');
const output = path.resolve(args['--output'] || 'voice-release');
const id = args['--id'] || 'tmrw-local-voice-android-arm64';
const version = args['--version'] || '1.0.0';
const rootName = id;
const chunkSize = 16 * 1024 * 1024;
if (!(await fs.stat(source).catch(() => null))?.isDirectory()) throw new Error('Use --source=<clean runtime directory>');

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const run = (command, commandArgs) => new Promise((resolve, reject) => { const child = spawn(command, commandArgs, { stdio: 'inherit' }); child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command} failed: ${code}`))); });

await fs.rm(output, { recursive: true, force: true }); await fs.mkdir(output, { recursive: true });
const stage = path.join(output, '.stage', rootName); await fs.mkdir(path.dirname(stage), { recursive: true }); await fs.cp(source, stage, { recursive: true });
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
await fs.mkdir(path.join(stage, 'bin'), { recursive: true });
if ((args['--platform'] || 'android-arm64').startsWith('android')) {
  await fs.copyFile(path.join(repositoryRoot, 'mobile-runtime', 'START-TMRW-VOICE-MOBILE.sh'), path.join(stage, 'bin', 'START-TMRW-VOICE-MOBILE.sh'));
  await fs.copyFile(path.join(repositoryRoot, 'mobile-runtime', 'STOP-TMRW-VOICE-MOBILE.sh'), path.join(stage, 'bin', 'STOP-TMRW-VOICE-MOBILE.sh'));
}
await fs.cp(path.join(repositoryRoot, 'voice-manager', 'tools'), path.join(stage, 'tools'), { recursive: true });
await fs.cp(path.join(repositoryRoot, 'voice-packs', 'catalog'), path.join(stage, 'catalog'), { recursive: true });
await fs.mkdir(path.join(stage, 'profiles', 'tmrw-male-core'), { recursive: true });
await fs.mkdir(path.join(stage, 'profiles', 'tmrw-female-core'), { recursive: true });
await fs.copyFile(path.join(repositoryRoot, 'voice-packs', 'profiles', 'tmrw-male-core.voiceprofile.npz'), path.join(stage, 'profiles', 'tmrw-male-core', 'voice.voiceprofile.npz'));
await fs.copyFile(path.join(repositoryRoot, 'voice-packs', 'profiles', 'tmrw-female-core.voiceprofile.npz'), path.join(stage, 'profiles', 'tmrw-female-core', 'voice.voiceprofile.npz'));
for (const file of ['tmrw_call_runtime_v093_deadline_gate.py', 'tmrw_voice_bridge.py']) {
  const candidates = [path.join(stage, 'runtime', file), path.join(stage, file)];
  for (const candidate of candidates) if ((await fs.stat(candidate).catch(() => null))?.isFile()) {
    let text = await fs.readFile(candidate, 'utf8');
    if (file === 'tmrw_call_runtime_v093_deadline_gate.py') text = patchMobileRuntime(text);
    else {
      const legacyName = ['puz', 'zle'].join('');
      text = text.replaceAll(`os.path.expanduser("~/${legacyName}.voiceprofile.npz")`, 'os.environ.get("TMRW_VOICE_PROFILE", os.path.expanduser("~/.tmrw-voice/profiles/tmrw-male-core/voice.voiceprofile.npz"))')
        .replace(new RegExp(`"voice":\\s*"${legacyName}"`, 'g'), '"voice": "TMRW Local Voice"');
    }
    await fs.writeFile(candidate, text);
  }
}
const runtimeCandidates = [path.join(stage, 'runtime', 'tmrw_call_runtime_v093_deadline_gate.py'), path.join(stage, 'tmrw_call_runtime_v093_deadline_gate.py')];
for (const runtime of runtimeCandidates) if ((await fs.stat(runtime).catch(() => null))?.isFile()) await fs.writeFile(path.join(stage, '.runtime.sha256'), `${digest(await fs.readFile(runtime))}\n`);
const archive = path.join(output, `${id}-${version}.tar.gz`); await run('tar', ['-czf', archive, '-C', path.dirname(stage), rootName]);
const bytes = await fs.readFile(archive); const parts = [];
for (let offset = 0, index = 0; offset < bytes.length; offset += chunkSize, index += 1) {
  const block = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)); const name = `${path.basename(archive)}.part-${String(index).padStart(5, '0')}`; await fs.writeFile(path.join(output, name), block);
  parts.push({ index, url: name, size: block.length, sha256: digest(block) });
}
const pack = { id, version, platform: args['--platform'] || 'android-arm64', rootDirectory: rootName, size: bytes.length, sha256: digest(bytes), parts };
await fs.writeFile(path.join(output, 'pack-index.json'), `${JSON.stringify({ schema: 'tmrw-voice-pack-index-v1', baseUrl: args['--base-url'] || './', packs: [pack] }, null, 2)}\n`);
await fs.rm(path.join(output, '.stage'), { recursive: true, force: true });
console.log(JSON.stringify(pack, null, 2));
