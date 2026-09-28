// Read-only scan of all reachable Git blobs. Never print candidate secret values.
import { execFileSync } from 'node:child_process';
const git = args => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
const objects = git(['rev-list', '--objects', '--all']).trim().split('\n').map(line => {
  const space = line.indexOf(' '); return { id: space < 0 ? line : line.slice(0, space), path: space < 0 ? '' : line.slice(space + 1) };
});
const rules = [
  ['google-api-key', /AIza[\w-]{35}/gu],
  ['github-token', /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})/gu],
  ['provider-token', /\bsk-(?:proj-|or-v1-)?[A-Za-z0-9_-]{32,}/gu],
  ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu],
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/gu],
  ['credential-assignment', /(?:api[_-]?key|password|access[_-]?token|client[_-]?secret)\s*['"]?\s*[:=]\s*['"]([A-Za-z0-9_+\/-]{24,})['"]/giu],
];
const matches = [], privatePathFiles = new Set(), sensitivePaths = new Set(), binaryPaths = new Set(); let blobs = 0, binary = 0;
for (let offset = 0; offset < objects.length; offset += 100) {
  const batch = objects.slice(offset, offset + 100);
  const output = execFileSync('git', ['cat-file', '--batch'], { input: batch.map(o => o.id).join('\n') + '\n', maxBuffer: 128 * 1024 * 1024 });
  let cursor = 0;
  for (const object of batch) {
    const end = output.indexOf(10, cursor), header = output.subarray(cursor, end).toString('utf8').split(' ');
    const size = Number(header[2]), data = output.subarray(end + 1, end + 1 + size); cursor = end + size + 2;
    if (header[1] !== 'blob') continue;
    blobs++;
    if (data.includes(0)) { binary++; if (object.path) binaryPaths.add(object.path); continue; }
    const text = data.toString('utf8');
    if (/(?:^|\/)(?:secrets?\.json|credentials?\.json|\.env(?:\.[^/]+)?|settings\.json|[^/]+\.jsonl)$/iu.test(object.path)) sensitivePaths.add(object.path);
    if (/C:[\\/]Users[\\/]|192\.168\.100\.125/u.test(text)) privatePathFiles.add(object.path);
    for (const [kind, regex] of rules) {
      regex.lastIndex = 0; const found = [...text.matchAll(regex)];
      if (found.length) matches.push({ object: object.id, path: object.path, kind, count: found.length });
    }
  }
}
console.log(JSON.stringify({ commits: Number(git(['rev-list', '--all', '--count'])), objects: objects.length, blobs, binary, binaryPaths: [...binaryPaths], candidates: matches, sensitivePaths: [...sensitivePaths], machineReferenceFiles: [...privatePathFiles], limitations: 'Pattern scan, not a guarantee. Binary blobs not searched; review inventory separately. Old history is retained.' }, null, 2));
if (matches.length || sensitivePaths.size) process.exitCode = 2;
