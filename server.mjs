import { runNetworkProbe } from './network-probe.mjs';
import http from 'node:http';
import { mkdir, stat, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const directory = process.env.DATA_DIR || '/app/data';
const report = { uid: process.getuid?.(), gid: process.getgid?.(), directory, checks: {} };
function failure(error) { return { ok: false, code: typeof error?.code === 'string' ? error.code : 'UNKNOWN' }; }
async function check(name, action) {
  try { report.checks[name] = { ok: true, ...await action() }; }
  catch (error) { report.checks[name] = failure(error); }
}
await check('directory', async () => {
  await mkdir(directory, { recursive: true });
  const info = await stat(directory);
  return { ownerUid: info.uid, ownerGid: info.gid, mode: (info.mode & 0o777).toString(8) };
});
await check('write', async () => {
  const file = join(directory, `.washbook-probe-${randomUUID()}`);
  const handle = await open(file, 'wx', 0o600);
  try { await handle.writeFile('storage probe'); await handle.sync(); }
  finally { await handle.close(); await unlink(file); }
  return {};
});
await check('sqlite', async () => {
  // Dedicated probe database; never opens washbook.sqlite.
  const db = new DatabaseSync(join(directory, 'washbook-storage-probe.sqlite'));
  try {
    db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS probe (id INTEGER PRIMARY KEY CHECK(id=1), starts INTEGER NOT NULL);');
    db.exec('BEGIN IMMEDIATE; INSERT INTO probe(id,starts) VALUES(1,1) ON CONFLICT(id) DO UPDATE SET starts=starts+1; COMMIT;');
    return { starts: db.prepare('SELECT starts FROM probe WHERE id=1').get().starts };
  } finally { db.close(); }
});
console.log(JSON.stringify({ event: 'STORAGE_PROBE', ...report }));
const server = http.createServer((req, res) => {
  // Public endpoints expose only liveness, never filesystem metadata or env.
  res.writeHead(req.url === '/' || req.url === '/health' ? 200 : 404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(req.url === '/' || req.url === '/health' ? 'Storage probe is running. Results are in container logs.\n' : 'Not found\n');
});
server.listen(Number(process.env.PORT || 8080), '0.0.0.0', () => {
  void runNetworkProbe().catch(() => console.log(JSON.stringify({ event: 'NETWORK_PROBE_FAILED' })));
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
