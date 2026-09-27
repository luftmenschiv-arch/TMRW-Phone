import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';
const root = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Pass candidate artifact directory');
const server = http.createServer(async (req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1);
  if (req.method !== 'GET' || !/^(?:install-index\.json|runtime\.part-\d{5})$/u.test(name)) { res.writeHead(404); res.end(); return; }
  const file = path.join(root, name), stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
server.listen(28780, '127.0.0.1', () => console.log('Local-only QA artifact server ready on 28780'));
