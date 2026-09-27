// Run on the approved Android device. Copies only runtime inputs to a NEW
// isolated directory; never modifies Golden, the active runtime or user data.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const home = '/data/data/com.termux/files/home';
const prefix = '/data/data/com.termux/files/usr';
const target = process.argv[2];
if (!target || path.dirname(target) !== home || !/^\.tmrw-distribution-stage-[a-z0-9-]+$/u.test(path.basename(target))) throw new Error('Use a new .tmrw-distribution-stage-* directly under Termux home');
if (await fs.lstat(target).catch(() => null)) throw new Error('Stage already exists');
await fs.mkdir(target);
const filter = file => !file.split(path.sep).some(s => ['__pycache__', '.cache', '.git'].includes(s)) && !/\.(?:pyc|pyo)$/u.test(file) && path.basename(file) !== 'direct_url.json';
const copy = async (from, to) => { await fs.mkdir(path.dirname(to), { recursive: true }); await fs.cp(from, to, { recursive: true, dereference: true, filter }); };
const native = `${home}/genie-python313/data/data/com.termux/files/usr`;
await copy(`${native}/bin/python3.13`, `${target}/python/bin/python3.13`);
await copy(`${native}/lib`, `${target}/python/lib`);
await copy(`${native}/share/doc/python`, `${target}/notices/python`);
await copy(`${home}/genie-tts-portable/venv/lib/python3.13/site-packages`, `${target}/python/site-packages`);
await copy(`${home}/genie-onnx-private/site-packages`, `${target}/onnx/site-packages`);
await copy(`${home}/genie-onnx-private/lib`, `${target}/lib`);
await copy(`${home}/genie-tts-portable/GenieData`, `${target}/GenieData`);
const models = ['prompt_encoder_fp16.bin','prompt_encoder_fp32.onnx','t2s_encoder_fp32.bin','t2s_encoder_fp32.onnx','t2s_first_stage_decoder_fp32.onnx','t2s_shared_fp16.bin','t2s_stage_decoder_fp32.onnx','vits_fp16.bin','vits_fp32.onnx'];
for (const name of models) await copy(`${home}/genie-tts-portable/CharacterModels/genie-v2proplus-base/${name}`, `${target}/model/${name}`);
await copy(`${home}/.tmrw-voice/current/stt`, `${target}/stt`);
const whisperBin = `${home}/.tmrw-voice/whisper.cpp-v1.9.4/build-tmrw/bin`;
for (const name of ['libwhisper.so.1','libggml.so.0','libggml-cpu.so.0','libggml-base.so.0']) await copy(`${whisperBin}/${name}`, `${target}/lib/${name}`);
await copy(`${home}/.tmrw-voice/whisper.cpp-v1.9.4/LICENSE`, `${target}/notices/whisper-LICENSE`);
await copy(`${home}/.tmrw-voice/current/runtime/tmrw_call_runtime_v093_deadline_gate.py`, `${target}/runtime/tmrw_call_runtime_v093_deadline_gate.py`);
const digest = data => crypto.createHash('sha256').update(data).digest('hex');
const runtimeFile = `${target}/runtime/tmrw_call_runtime_v093_deadline_gate.py`;
let runtime = await fs.readFile(runtimeFile, 'utf8');
if (digest(Buffer.from(runtime)) !== '1300db3c5ca48945bfdcbf80a72f732e862e82d82122d9d2929bf9192a2aa77b') throw new Error('Active clone-only runtime changed; audit before packaging');
// Packaging-only configurability permits isolated qualification on another port.
runtime = runtime.replace('HOST = "127.0.0.1"', 'HOST = os.environ.get("TMRW_VOICE_HOST", "127.0.0.1")').replace('PORT = 18769', 'PORT = int(os.environ.get("TMRW_VOICE_PORT", "18769"))');
await fs.writeFile(runtimeFile, runtime);
await fs.writeFile(`${target}/.runtime.sha256`, `${digest(Buffer.from(runtime))}\n`);

async function walk(dir) {
  const files = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (e.isSymbolicLink()) throw new Error(`Unresolved symlink: ${e.name}`);
    if (e.isDirectory()) files.push(...await walk(path.join(dir, e.name)));
    else files.push(path.join(dir, e.name));
  }
  return files;
}
// ELF64 DT_NEEDED closure, not a guessed list of host packages. System Android
// libraries remain OS-provided; Termux/private libraries are copied and pinned.
function dependencies(bytes) {
  if (bytes.length < 64 || bytes.toString('ascii', 1, 4) !== 'ELF') return [];
  if (bytes[4] !== 2 || bytes[5] !== 1 || bytes.readUInt16LE(18) !== 183) throw new Error('Non-arm64 ELF in Android payload');
  const offset = Number(bytes.readBigUInt64LE(40)), size = bytes.readUInt16LE(58), count = bytes.readUInt16LE(60);
  for (let i = 0; i < count; i++) {
    const s = offset + i * size;
    if (bytes.readUInt32LE(s + 4) !== 6) continue;
    const begin = Number(bytes.readBigUInt64LE(s + 24)), length = Number(bytes.readBigUInt64LE(s + 32));
    const strings = offset + bytes.readUInt32LE(s + 40) * size;
    const stringsOffset = Number(bytes.readBigUInt64LE(strings + 24));
    const needed = [];
    for (let at = begin; at < begin + length; at += 16) if (bytes.readBigInt64LE(at) === 1n) {
      const start = stringsOffset + Number(bytes.readBigUInt64LE(at + 8));
      needed.push(bytes.toString('utf8', start, bytes.indexOf(0, start)));
    }
    return needed;
  }
  return [];
}
const system = new Set(['libc.so','libm.so','libdl.so','liblog.so','libandroid.so','libz.so']);
const search = [`${target}/lib`, `${target}/python/lib`, `${prefix}/lib`];
const queue = await walk(target), seen = new Set(), added = [];
while (queue.length) {
  const file = queue.pop(); if (seen.has(file)) continue; seen.add(file);
  for (const name of dependencies(await fs.readFile(file))) {
    if (system.has(name)) continue;
    if (!/^[A-Za-z0-9_.+-]+$/u.test(name)) throw new Error(`Unsafe dependency: ${name}`);
    let found;
    for (const dir of search) if ((await fs.stat(path.join(dir, name)).catch(() => null))?.isFile()) { found = path.join(dir, name); break; }
    if (!found) throw new Error(`Unresolved ELF dependency ${name} for ${file}`);
    if (found.startsWith(`${prefix}/`)) {
      const dest = `${target}/lib/${name}`; await copy(found, dest); added.push(name); queue.push(dest);
    } else queue.push(found);
  }
}
console.log(JSON.stringify({ target, files: seen.size, bundledSystemDependencies: [...new Set(added)].sort(), sourceRuntimeSha256: '1300db3c5ca48945bfdcbf80a72f732e862e82d82122d9d2929bf9192a2aa77b', stagedRuntimeSha256: digest(Buffer.from(runtime)) }, null, 2));
