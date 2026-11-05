import { mkdir, lstat, chown } from 'node:fs/promises';
import { join } from 'node:path';

// This diagnostic bootstrap only prepares its own fixed data directory.
const directory = '/app/data';
if (process.getuid?.() === 0) {
  try {
    if (process.env.DATA_DIR && process.env.DATA_DIR !== directory) throw new Error('UNSUPPORTED_DATA_DIR');
    await mkdir(directory, { recursive: true });
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('UNSAFE_DATA_DIRECTORY');
    await chown(directory, 1000, 1000);
    // Only this probe's files; no recursive ownership changes and no WashBook DB access.
    for (const name of ['washbook-storage-probe.sqlite', 'washbook-storage-probe.sqlite-wal', 'washbook-storage-probe.sqlite-shm']) {
      const file = join(directory, name);
      try {
        const item = await lstat(file);
        if (!item.isFile() || item.isSymbolicLink()) throw new Error('UNSAFE_PROBE_FILE');
        await chown(file, 1000, 1000);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    console.log(JSON.stringify({ event: 'STORAGE_PREPARE', ok: true }));
  } catch (error) {
    console.log(JSON.stringify({ event: 'STORAGE_PREPARE', ok: false, code: error.code || 'PREPARE_FAILED' }));
  }
  // Do not serve HTTP or open SQLite as root, even when preparation failed.
  try { process.setgroups([]); process.setgid(1000); process.setuid(1000); }
  catch { console.error(JSON.stringify({ event: 'PRIVILEGE_DROP_FAILED' })); process.exit(1); }
} else {
  console.log(JSON.stringify({ event: 'STORAGE_PREPARE', ok: false, code: 'NOT_ROOT' }));
}
await import('./server.mjs');
