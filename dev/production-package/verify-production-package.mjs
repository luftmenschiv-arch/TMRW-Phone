import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  V3_EXTENSION_DIRECTORY_NAME,
  V3_GENERATION_INTERCEPTOR_KEY,
} from '../../production/constants.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const v3Root = path.resolve(here, '../..');
const distRoot = path.join(v3Root, 'dist', V3_EXTENSION_DIRECTORY_NAME);

const ALLOWED_RUNTIME_DIRS = new Set([
  'production', 'application', 'beta', 'domain', 'director', 'handoff',
  'migration', 'platform', 'prompt', 'storage', 'ui',
]);
const TOP_LEVEL_FILES = new Set(['manifest.json', 'index.js', 'style.css']);

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

async function walkFiles(root, relative = '') {
  const directory = path.join(root, relative);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(root, child));
    else if (entry.isFile()) files.push(child.split(path.sep).join('/'));
  }
  return files.sort();
}

function assertPackagePath(relativePath) {
  if (/^voice-packs\/previews\/(?:male|female)-[a-z0-9-]+-(?:en|ja)\.wav$/u.test(relativePath)) return;
  const parts = relativePath.split('/');
  if (parts.length === 1) {
    if (!TOP_LEVEL_FILES.has(relativePath)) throw new Error(`Unexpected top-level package file: ${relativePath}`);
    return;
  }
  if (parts[0] !== 'v3' || !ALLOWED_RUNTIME_DIRS.has(parts[1])) {
    throw new Error(`Package file is outside the runtime allowlist: ${relativePath}`);
  }
  if (parts.some(part => ['.git', '.serena', 'dev', 'tests'].includes(part))) {
    throw new Error(`Protected/dev tooling leaked into package: ${relativePath}`);
  }
}

function resolveImport(importerRelative, specifier) {
  if (!specifier.startsWith('.')) throw new Error(`Bare browser import is not allowed: ${specifier} from ${importerRelative}`);
  return path.posix.normalize(path.posix.join(path.posix.dirname(importerRelative), specifier));
}

export async function verifyProductionPackage() {
  const stat = await fs.stat(distRoot).catch(() => null);
  if (!stat?.isDirectory()) throw new Error(`Production package output is missing: ${distRoot}`);

  const manifest = JSON.parse(await fs.readFile(path.join(distRoot, 'manifest.json'), 'utf8'));
  if (manifest.display_name !== 'TMRW Phone') throw new Error('Production package display_name mismatch');
  if (manifest.loading_order !== 60) throw new Error('Production package candidate loading_order mismatch');
  if (manifest.js !== 'index.js' || manifest.css !== 'style.css') throw new Error('Production package entry paths mismatch');
  if (manifest.auto_update !== false) throw new Error('Production package auto_update must remain false');
  if (manifest.hooks?.activate !== 'onActivate' || manifest.hooks?.enable !== 'onEnable' || manifest.hooks?.disable !== 'onDisable') {
    throw new Error('Production package lifecycle hook ownership mismatch');
  }
  if (manifest.generate_interceptor !== V3_GENERATION_INTERCEPTOR_KEY) throw new Error('Production package generation interceptor ownership mismatch');

  const files = await walkFiles(distRoot);
  for (const relativePath of files) assertPackagePath(relativePath);
  const previewFiles = files.filter(file => file.startsWith('voice-packs/previews/'));
  if (previewFiles.length !== 48) throw new Error(`Production package requires 48 preset previews, found ${previewFiles.length}`);
  for (const relativePath of previewFiles) {
    const audio = await fs.readFile(path.join(distRoot, ...relativePath.split('/')));
    if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`Invalid preset WAV: ${relativePath}`);
  }
  if (files.some(relativePath => /TMRW-Phone-Preview/i.test(relativePath))) throw new Error('Preview files were copied into the v3 package');

  const fileSet = new Set(files);
  let importCount = 0;
  for (const relativePath of files.filter(file => /\.(?:js|mjs|css)$/i.test(file))) {
    const source = await fs.readFile(path.join(distRoot, ...relativePath.split('/')), 'utf8');
    if (/C:\\ai\\|C:\/ai\/|tmrw-extension-phase\d+-shadow|TMRW-Voice-(?:Golden|PC-Runtime|Mobile-Optimization)/i.test(source)) {
      throw new Error(`Protected filesystem path leaked into browser runtime package: ${relativePath}`);
    }
    for (const specifier of importedSpecifiers(relativePath, source)) {
      const target = resolveImport(relativePath, specifier);
      if (!fileSet.has(target)) throw new Error(`Package import target is missing: ${relativePath} -> ${specifier}`);
      importCount += 1;
    }
  }

  const previousShim = globalThis[V3_GENERATION_INTERCEPTOR_KEY];
  try {
    delete globalThis[V3_GENERATION_INTERCEPTOR_KEY];
    const module = await import(`${pathToFileURL(path.join(distRoot, 'index.js')).href}?verify=${Date.now()}`);
    if (typeof module.onActivate !== 'function' || typeof module.onEnable !== 'function' || typeof module.onDisable !== 'function') {
      throw new Error('Built package lifecycle exports are incomplete');
    }
    if (typeof globalThis[V3_GENERATION_INTERCEPTOR_KEY] !== 'function') throw new Error('Passive generation interceptor shim is not installed');
    const status = module.getProductionEntryStatus();
    if (!status?.passive || status.databaseOpen || status.leaseAcquired || status.authoringGateOpen || status.phoneRootMounted || status.launcherMounted || status.previewStateChanged || status.canonicalWrites !== 0) {
      throw new Error('Built package import is not operationally passive');
    }
  } finally {
    if (previousShim === undefined) delete globalThis[V3_GENERATION_INTERCEPTOR_KEY];
    else globalThis[V3_GENERATION_INTERCEPTOR_KEY] = previousShim;
  }

  return Object.freeze({
    outputRoot: distRoot,
    files: files.length,
    importEdges: importCount,
    manifest: Object.freeze({
      displayName: manifest.display_name,
      loadingOrder: manifest.loading_order,
      generateInterceptor: manifest.generate_interceptor,
    }),
    passiveImport: true,
    protectedPaths: false,
    previewFilesCopied: false,
    voicePreviewFiles: previewFiles.length,
  });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const result = await verifyProductionPackage();
  console.log(JSON.stringify(result, null, 2));
}
