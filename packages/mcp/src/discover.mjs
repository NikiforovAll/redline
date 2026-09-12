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

/**
 * The app the caller runs under, when the environment says so. `VSCODE_PID` reaches every child of a
 * window (integrated terminals, the Claude Code extension) and names its main process exactly.
 * `REDLINE_VSCODE_APP` is the manual override; `TERM_PROGRAM_VERSION` ends in `-insider` inside an
 * Insiders terminal.
 */
function callerWindow(env = process.env) {
  const appPid = Number(env.VSCODE_PID);
  let app = env.REDLINE_VSCODE_APP;
  if (!app && env.TERM_PROGRAM === 'vscode') {
    app = /-insider/.test(env.TERM_PROGRAM_VERSION ?? '') ? 'vscode-insiders' : 'vscode';
  }
  return { appPid: appPid > 0 ? appPid : undefined, app };
}

/** Same folder in several windows: the caller's own window wins, then its app, then the newest. */
function affinity(lock, caller) {
  if (caller.appPid && lock.appPid === caller.appPid) return 2;
  if (caller.app && lock.app === caller.app) return 1;
  return 0;
}

export async function discover(cwd = process.cwd(), env = process.env) {
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

  const caller = callerWindow(env);
  const chosen = live
    .flatMap((lock) =>
      lock.workspaceFolders.filter((folder) => contains(folder, target)).map((folder) => ({ lock, folder }))
    )
    .sort(
      (a, b) =>
        b.folder.length - a.folder.length ||
        affinity(b.lock, caller) - affinity(a.lock, caller) ||
        String(b.lock.startedAt ?? '').localeCompare(String(a.lock.startedAt ?? ''))
    )[0];
  const best = chosen?.lock ?? null;
  const bestFolder = chosen?.folder ?? null;

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
