import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const output = path.resolve(process.argv[2] || '');
if (!process.argv[2] || await fs.stat(output).catch(() => null)) throw new Error('Pass NEW output directory');
await fs.mkdir(output, { recursive: true });
const urls = {
  'genie-MIT.txt': 'https://raw.githubusercontent.com/High-Logic/Genie-TTS/master/LICENSE',
  'gpt-sovits-MIT.txt': 'https://raw.githubusercontent.com/RVC-Boss/GPT-SoVITS/main/LICENSE',
  'onnxruntime-MIT.txt': 'https://raw.githubusercontent.com/microsoft/onnxruntime/main/LICENSE',
  'onnxruntime-ThirdPartyNotices.txt': 'https://raw.githubusercontent.com/microsoft/onnxruntime/main/ThirdPartyNotices.txt',
  'abseil-Apache-2.0.txt': 'https://raw.githubusercontent.com/abseil/abseil-cpp/master/LICENSE',
  'abseil-AUTHORS.txt': 'https://raw.githubusercontent.com/abseil/abseil-cpp/master/AUTHORS',
  'openblas-BSD.txt': 'https://raw.githubusercontent.com/OpenMathLib/OpenBLAS/develop/LICENSE',
  'lapack-BSD.txt': 'https://raw.githubusercontent.com/OpenMathLib/OpenBLAS/develop/lapack-netlib/LICENSE',
  'protobuf-BSD.txt': 'https://raw.githubusercontent.com/protocolbuffers/protobuf/main/LICENSE',
  're2-BSD.txt': 'https://raw.githubusercontent.com/google/re2/main/LICENSE',
  'utf8-range-MIT.txt': 'https://raw.githubusercontent.com/protocolbuffers/utf8_range/main/LICENSE',
  'whisper-model-MIT.txt': 'https://raw.githubusercontent.com/openai/whisper/main/LICENSE',
};
const records = [];
for (const [file, url] of Object.entries(urls)) {
  const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`${file}:${r.status}`);
  const b = Buffer.from(await r.arrayBuffer());
  if (b.length < 100 || b.length > 2 * 1024 ** 2) throw new Error('unexpected-notice-size');
  await fs.writeFile(path.join(output, file), b);
  records.push({ file, url, bytes: b.length, sha256: crypto.createHash('sha256').update(b).digest('hex') });
}
await fs.writeFile(path.join(output, 'upstream-notices.json'), JSON.stringify({ collected: new Date().toISOString(), note: 'License text snapshots; URLs at collection time, not a claim of exact native build source provenance. Installed distribution metadata also accompanies the package.', records }, null, 2) + '\n');
console.log(JSON.stringify({ output, notices: records.length }));
