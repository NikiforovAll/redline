import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { redlineHome, isAlive, normalizeWorkspacePath } from './redline-home.mjs';

export { redlineHome, isAlive, normalizeWorkspacePath };

function contains(folder, cwd) {
  return cwd === folder || cwd.startsWith(folder.endsWith('/') ? folder : `${folder}/`);
}

function readLocks(dir) {
  let names;
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.lock'));
  } catch {
    names = [];
  }
  const locks = [];
  for (const name of names) {
    const file = join(dir, name);
    let data;
    try {
      data = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    if (!data || typeof data.port !== 'number' || typeof data.token !== 'string') continue;
    const folders = Array.isArray(data.workspaceFolders)
      ? data.workspaceFolders.map(normalizeWorkspacePath)
      : [];
    locks.push({ name, file, ...data, workspaceFolders: folders });
  }
  return locks;
}

async function ping(lock) {
  const res = await fetch(`http://127.0.0.1:${lock.port}/ping`, {
    headers: { authorization: `Bearer ${lock.token}` },
    signal: AbortSignal.timeout(2000)
  });
  if (!res.ok) throw new Error(`ping returned ${res.status}`);
  return await res.json();
}

export const DISCOVER_NO_LOCK = 'no_lock';
export const DISCOVER_STALE_LOCK = 'stale_lock';

function discoverError(code, message, extra = {}) {
  const err = new Error(message);
  err.code = code;
  Object.assign(err, extra);
  return err;
}

export async function discover(cwd = process.cwd()) {
  const dir = redlineHome();
  const target = normalizeWorkspacePath(cwd);
  const all = readLocks(dir);
  const live = all.filter((l) => isAlive(l.pid));

  if (live.length === 0) {
    throw discoverError(
      DISCOVER_NO_LOCK,
      `redline: no lock files in ${dir} (is the redline extension running in VS Code?)`,
      { cwd: target }
    );
  }

  let best = null;
  let bestFolder = null;
  let bestLen = -1;
  for (const lock of live) {
    for (const folder of lock.workspaceFolders) {
      if (contains(folder, target) && folder.length > bestLen) {
        best = lock;
        bestFolder = folder;
        bestLen = folder.length;
      }
    }
  }

  if (!best) {
    const windows = live.flatMap((l) => l.workspaceFolders).join(', ');
    throw discoverError(
      DISCOVER_NO_LOCK,
      `redline: lock found but VS Code window is not for this folder (windows: ${windows}); open ${target} in a VS Code window running the redline extension`,
      { cwd: target }
    );
  }

  let info;
  try {
    info = await ping(best);
  } catch {
    throw discoverError(
      DISCOVER_STALE_LOCK,
      `redline: lock stale (ping failed), remove ${join(dir, best.name)}`,
      { cwd: target, folder: bestFolder ?? target, lockFile: join(dir, best.name) }
    );
  }

  return { port: best.port, token: best.token, ping: info };
}
