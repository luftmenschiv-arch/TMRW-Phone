import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, '../..');
const args = Object.fromEntries(process.argv.slice(2).map(v => v.split(/=(.*)/s).slice(0, 2)));
if (!args['--candidate'] || !args['--output']) throw new Error('Pass --candidate=<verified beta> --output=<new directory>');
const candidate = path.resolve(args['--candidate']);
const output = path.resolve(args['--output']);
if (await fs.stat(output).catch(() => null)) throw new Error('Output exists; refusing to overwrite');
for (const protectedRoot of [source, candidate]) {
  const relative = path.relative(protectedRoot, output);
  const reverse = path.relative(output, protectedRoot);
  if (!relative || !relative.startsWith('..') || !reverse.startsWith('..')) throw new Error('Output must be separate from source and candidate');
}
execFileSync(process.execPath, [path.join(here, 'verify-beta-candidate.mjs'), `--candidate=${candidate}`], { stdio: 'inherit' });
const baseline = JSON.parse(await fs.readFile(path.join(candidate, 'beta-candidate.json'), 'utf8'));
const version = baseline.version;
if (version !== '0.1.0-beta.2') throw new Error('Public template is qualified only for beta.2');
const repository = path.join(output, 'SillyTavern-Extension-TMRW-Phone');
const artifacts = path.join(output, 'artifacts');
const companion = path.join(output, 'companion');
await fs.mkdir(output, { recursive: true });
await fs.cp(path.join(candidate, baseline.components.extension.path), repository, { recursive: true });
await fs.cp(path.join(here, 'public-template'), repository, { recursive: true });
await fs.cp(path.join(candidate, 'app'), path.join(companion, 'app'), { recursive: true });
await fs.mkdir(artifacts);
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function walk(root, prefix = '') {
  const files = [];
  for (const entry of await fs.readdir(path.join(root, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Symlink rejected: ${rel}`);
    if (entry.isDirectory()) files.push(...await walk(root, rel));
    else files.push(rel);
  }
  return files.sort();
}
// Mechanical LF normalization makes Git clones and Termux shell assets portable.
async function inventory(root) {
  const files = [];
  for (const rel of await walk(root)) {
    if (/(?:^|\/)(?:\.git|\.serena|node_modules|secrets\.json|settings\.json|\.env|sessions|uploads|recordings)(?:\/|$)/u.test(rel)) throw new Error(`Private path rejected: ${rel}`);
    const absolute = path.join(root, rel);
    let bytes = await fs.readFile(absolute);
    if (/\.(?:mjs|js|json|md|css|sh|py)$/u.test(rel) || ['.gitignore', '.gitattributes'].includes(rel)) {
      const text = bytes.toString('utf8').replace(/\r\n/gu, '\n');
      if (/(?:AIza[\w-]{30,}|ghp_[\w]{25,}|github_pat_[\w]{25,}|sk-or-v1-[\da-f]{32,})/u.test(text)) throw new Error(`Potential credential in ${rel}`);
      if (/C:[\\/]Users[\\/]lolit[\\/]|192\.168\.100\.125/u.test(text)) throw new Error(`Personal device reference in ${rel}`);
      bytes = Buffer.from(text); await fs.writeFile(absolute, bytes);
    }
    files.push({ path: rel, bytes: bytes.length, sha256: digest(bytes) });
  }
  return files;
}
const companionFiles = await inventory(companion);
const profileFiles = companionFiles.filter(f => /app\/voice-packs\/profiles\/(?:male|female)-.*\.voiceprofile\.npz$/u.test(f.path));
if (profileFiles.length !== 24 || new Set(profileFiles.map(f => f.sha256)).size !== 24) throw new Error('Companion identities collapsed');
const companionManifest = {
  schema: 'tmrw-voice-companion-v1', version, status: 'components-only-not-a-complete-runtime',
  voiceManagerVersion: baseline.components.voiceManager.version,
  presetCatalogVersion: baseline.components.presetCatalog.version,
  identities: 24, prerequisitesNotBundled: baseline.prerequisitesNotBundled,
  files: companionFiles,
};
await fs.writeFile(path.join(companion, 'voice-companion.manifest.json'), `${JSON.stringify(companionManifest, null, 2)}\n`);
const companionName = `tmrw-voice-companion-${version}.tar.gz`;
execFileSync('tar', ['-czf', path.join(artifacts, companionName), '-C', companion, 'app', 'voice-companion.manifest.json']);
await fs.copyFile(path.join(companion, 'voice-companion.manifest.json'), path.join(artifacts, 'voice-companion.manifest.json'));
const companionBytes = await fs.readFile(path.join(artifacts, companionName));
const release = {
  schema: 'tmrw-public-beta-v1', version, channel: 'beta', stable: false,
  repository: 'https://github.com/luftmenschiv-arch/SillyTavern-Extension-TMRW-Phone',
  components: { extension: version, voiceManager: baseline.components.voiceManager.version, presetCatalog: baseline.components.presetCatalog.version, presets: 24, previews: 48 },
  compatibility: { keyflow: '1.5.1', focusedTestsPassed: 51, liveProviderQualification: false },
  pending: ['fresh-device-termux-installer', 'complete-runtime-model-download', 'automatic-updates', 'live-mobile-qualification'],
  companion: { file: companionName, bytes: companionBytes.length, sha256: digest(companionBytes), completeRuntime: false },
  candidateManifestSha256: digest(await fs.readFile(path.join(candidate, 'beta-candidate.json'))),
  textNormalization: 'LF',
  files: await inventory(repository),
};
await fs.writeFile(path.join(repository, 'release.json'), `${JSON.stringify(release, null, 2)}\n`);
execFileSync(process.execPath, [path.join(repository, 'scripts/verify-release.mjs')], { stdio: 'inherit' });
const extensionName = `tmrw-phone-${version}.zip`;
execFileSync('tar', ['-a', '-cf', path.join(artifacts, extensionName), '-C', output, path.basename(repository)]);
await fs.copyFile(path.join(repository, 'release.json'), path.join(artifacts, 'release.json'));
const sums = [];
for (const file of await walk(artifacts)) sums.push(`${digest(await fs.readFile(path.join(artifacts, file)))}  ${file}`);
await fs.writeFile(path.join(artifacts, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`);
console.log(JSON.stringify({ repository, artifacts, files: release.files.length, companionBytes: companionBytes.length, status: 'ready-for-reviewed-publication' }, null, 2));
