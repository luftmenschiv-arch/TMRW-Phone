import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { V3_EXTENSION_DIRECTORY_NAME } from '../../production/constants.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const v3Root = path.resolve(here, '../..');
const templateRoot = path.join(v3Root, 'production', 'package');
const distRoot = path.join(v3Root, 'dist', V3_EXTENSION_DIRECTORY_NAME);

const ALLOWED_RUNTIME_DIRS = Object.freeze([
  'production',
  'application',
  'beta',
  'domain',
  'director',
  'handoff',
  'migration',
  'platform',
  'prompt',
  'storage',
  'ui',
]);

const TEMPLATE_FILES = Object.freeze(['manifest.json', 'index.js', 'style.css']);

function portable(value) {
  return value.split(path.sep).join('/');
}

function packageRelativeFromSpecifier(importerRelative, specifier) {
  if (!specifier.startsWith('.')) return null;
  return path.posix.normalize(path.posix.join(path.posix.dirname(importerRelative), specifier));
}

function importedSpecifiers(relativePath, source) {
  const result = new Set();
  if (/\.css$/i.test(relativePath)) {
    for (const match of source.matchAll(/@import\s+(?:url\()?\s*['"]([^'"]+)['"]/g)) result.add(match[1]);
    return [...result];
  }
  for (const match of source.matchAll(/(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"]([^'"]+)['"]/g)) result.add(match[1]);
  for (const match of source.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) result.add(match[1]);
  return [...result];
}

function assertAllowedRuntimePath(relativePath) {
  if (!relativePath.startsWith('v3/')) throw new Error(`Runtime package import escapes v3/: ${relativePath}`);
  const parts = relativePath.split('/');
  if (!ALLOWED_RUNTIME_DIRS.includes(parts[1])) throw new Error(`Runtime package import is outside the S04 allowlist: ${relativePath}`);
  if (parts.includes('dev') || parts.includes('tests') || parts.includes('.git') || parts.includes('.serena')) {
    throw new Error(`Runtime package import reaches protected/dev tooling: ${relativePath}`);
  }
}

async function resolveRuntimeSource(relativePath) {
  assertAllowedRuntimePath(relativePath);
  const sourcePath = path.join(v3Root, ...relativePath.split('/').slice(1));
  const stat = await fs.stat(sourcePath).catch(() => null);
  if (!stat?.isFile()) throw new Error(`Package import target is missing: ${relativePath}`);
  return sourcePath;
}

export async function buildProductionPackage() {
  await fs.rm(distRoot, { recursive: true, force: true });
  await fs.mkdir(distRoot, { recursive: true });
  for (const directory of ALLOWED_RUNTIME_DIRS) await fs.mkdir(path.join(distRoot, 'v3', directory), { recursive: true });

  for (const fileName of TEMPLATE_FILES) {
    await fs.copyFile(path.join(templateRoot, fileName), path.join(distRoot, fileName));
  }

  const queue = [];
  const queued = new Set();
  const enqueue = relativePath => {
    if (queued.has(relativePath)) return;
    assertAllowedRuntimePath(relativePath);
    queued.add(relativePath);
    queue.push(relativePath);
  };

  for (const fileName of ['index.js', 'style.css']) {
    const source = await fs.readFile(path.join(templateRoot, fileName), 'utf8');
    for (const specifier of importedSpecifiers(fileName, source)) {
      const relativePath = packageRelativeFromSpecifier(fileName, specifier);
      if (relativePath === null) throw new Error(`Bare runtime package import is not allowed in ${fileName}: ${specifier}`);
      enqueue(relativePath);
    }
  }

  const copied = [];
  while (queue.length) {
    const relativePath = queue.shift();
    const sourcePath = await resolveRuntimeSource(relativePath);
    const source = await fs.readFile(sourcePath, 'utf8');
    const destinationPath = path.join(distRoot, ...relativePath.split('/'));
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.copyFile(sourcePath, destinationPath);
    copied.push(relativePath);

    for (const specifier of importedSpecifiers(relativePath, source)) {
      if (!specifier.startsWith('.')) throw new Error(`Browser runtime package cannot import bare specifier ${specifier} from ${relativePath}`);
      enqueue(packageRelativeFromSpecifier(relativePath, specifier));
    }
  }

  // Preset auditions must be packaged as ready-to-play audio. They must not
  // depend on an installed or running local voice service.
  const previewSource = path.join(v3Root, 'voice-packs', 'previews');
  const previewDestination = path.join(distRoot, 'voice-packs', 'previews');
  const previews = (await fs.readdir(previewSource)).filter(name => /^(?:male|female)-[a-z0-9-]+-(?:en|ja)\.wav$/u.test(name));
  if (previews.length !== 48) throw new Error(`Production package requires 48 preset previews, found ${previews.length}`);
  await fs.mkdir(previewDestination, { recursive: true });
  for (const name of previews) await fs.copyFile(path.join(previewSource, name), path.join(previewDestination, name));

  return Object.freeze({
    outputRoot: distRoot,
    templates: [...TEMPLATE_FILES],
    runtimeFiles: copied.sort(),
    runtimeDirectories: [...ALLOWED_RUNTIME_DIRS],
  });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const result = await buildProductionPackage();
  console.log(JSON.stringify(result, null, 2));
}
